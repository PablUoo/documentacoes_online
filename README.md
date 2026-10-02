# Documentos Online (QR Code)

Site estático para o GitHub Pages: você cadastra documentos PDF (link do Google Drive ou upload direto), e cada um ganha um QR Code que abre uma página com visualização e botão de download.

## Páginas

| Página | Para quê |
|---|---|
| `/` | Redireciona para o painel admin (não há lista pública) |
| `doc.html?id=...` | Página do documento: é o endereço que o QR Code abre (a única parte pública) |
| `/admin` | Painel (com login) para cadastrar, editar, excluir e gerar os QR Codes |

O QR Code aponta para a página `doc.html?id=...`, e não direto para o arquivo. Assim você pode **trocar o PDF ou o link do Drive sem reimprimir o QR Code**, e desativar o documento quando quiser.

## Como publicar

1. Crie um repositório **público** no GitHub (ex.: `documentacoes_online`) e envie todos os arquivos desta pasta.
2. No repositório: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`** → Save.
3. Em ~1 minuto o site fica em `https://SEU_USUARIO.github.io/documentacoes_online/`.

## Painel admin: login e senha

O painel fica em `/admin` (ex.: `https://documentacoes.duckdns.org/admin`).

**Configuração fixa:** usuário, repositório e branch do GitHub ficam em [`assets/config.js`](assets/config.js). Esse arquivo é público, então não coloque segredos nele.

**Primeiro acesso (uma vez só):**
1. Crie um token: GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - **Repository access:** *Only select repositories* → este repositório.
   - **Add permissions → Contents** → troque para **Read and write**.
2. Abra `/admin`, escolha um **usuário** e uma **senha** para o painel, cole o token e clique em **Salvar e entrar**.

Depois disso, em qualquer navegador ou celular, basta entrar com usuário e senha.

**Como fica seguro sem servidor:** o token fica em `data/acesso.json` num "cofre" criptografado (AES-GCM) com uma chave mestra aleatória. Cada admin tem a própria cópia da chave mestra, criptografada com o usuário e a senha dele (PBKDF2-SHA256, 600 mil iterações). O arquivo é público, mas sem um usuário e senha válidos nada pode ser lido. Use senhas longas: quem baixar o arquivo pode tentar adivinhar uma senha à força.

- **Usuários:** botão **Usuários** no painel para criar e remover admins. Cada um entra com o próprio usuário e senha.
- **Token do GitHub venceu ou foi revogado:** basta entrar com o seu usuário e senha de sempre. O painel percebe que o token não funciona e pede só um token novo. Senhas e outros admins continuam iguais.
- **Trocar senha:** botão **Trocar senha**. Muda só o seu usuário e senha. Se informar um token novo (ex.: o antigo venceu), ele passa a valer para todos os admins.
- **Esqueceu a senha:** peça para outro admin remover e recriar o seu usuário. Se ninguém conseguir entrar, abra `/admin?recuperar` (a opção fica escondida na tela de login normal), clique em *Configure o acesso de novo* com um token válido (isso recria o acesso e os outros admins precisam ser cadastrados de novo).
- **Remover um admin** impede novos logins dele. Se ele já viu o token, troque o token também para cortar o acesso por completo.
- **Manter conectado neste computador:** marque na tela de login para não precisar entrar de novo nesse navegador. Sem marcar, a sessão termina ao fechar a aba.
- **Sair:** encerra a sessão e apaga o token deste navegador.

## Cadastrando documentos

- **Google Drive:** no Drive, clique em *Compartilhar → Acesso geral → Qualquer pessoa com o link* e cole o link no painel. Também funciona com Google Docs, Planilhas e Apresentações (o download sai em PDF).
- **Enviar PDF:** o arquivo vai para a pasta `arquivos/` do repositório. Limite de 25 MB por arquivo. Para arquivos maiores, use o Drive.

Depois de salvar, clique em **QR Code** e escolha:

- **Imprimir A4**: abre uma folha no estilo manual, com título, QR Code no centro e instruções de como escanear. Dá para clicar nos textos e editar antes de imprimir. Use **Imprimir / Salvar PDF**.
- **Baixar PNG**: só o QR Code com o título embaixo, para usar em etiquetas ou outros materiais.
- **Copiar link**.

### Dono e compartilhamento

- Cada documento tem um **dono**: o admin que o criou. Só o dono edita ou exclui.
- Por padrão, só o dono vê o documento no painel. Marque **Compartilhar com todos os admins** para os outros também verem e imprimirem o QR Code, mas sem poder editar.
- Use o filtro ao lado da busca para ver **Todos**, **Meus** ou **Compartilhados comigo**.
- Documentos criados antes dessa função aparecem como **Sem dono**, e qualquer admin pode editar. Quem salvar um deles primeiro vira o dono.
- Isso organiza o painel, mas não é uma trava de segurança: todos os admins usam o mesmo token do GitHub, então quem tiver conhecimento técnico consegue alterar qualquer documento direto pela API. Cadastre como admin só quem é de confiança.

## Observações

- Depois de salvar, o GitHub Pages leva cerca de 1 minuto para publicar a mudança.
- O repositório é público, então os PDFs enviados e a lista `data/documentos.json` podem ser vistos por qualquer pessoa. Não use para documentos sigilosos.
- Desmarcar **Ativo** bloqueia o acesso sem invalidar o QR Code. **Excluir** remove o documento de vez, e o QR Code para de funcionar.
