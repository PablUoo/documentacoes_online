# Documentos Online (QR Code)

Site estático para o GitHub Pages: você cadastra documentos PDF (link do Google Drive ou upload direto), e cada um ganha um QR Code que abre uma página com visualização e botão de download.

## Páginas

| Página | Para quê |
|---|---|
| `index.html` | Lista pública dos documentos (com busca) |
| `doc.html?id=...` | Página do documento: é o endereço que o QR Code abre |
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

**Como fica seguro sem servidor:** o token é salvo em `data/acesso.json` **criptografado** (AES-GCM), com uma chave derivada do usuário e da senha (PBKDF2-SHA256, 600 mil iterações). O arquivo é público, mas sem usuário e senha o token não pode ser lido. Use uma senha longa: quem baixar o arquivo pode tentar adivinhar a senha à força.

- **Trocar senha:** botão **Trocar senha** dentro do painel (o token pode continuar o mesmo).
- **Esqueceu a senha ou o token venceu:** na tela de login, clique em *Configure o acesso de novo* e use um token válido.
- **Sair:** encerra a sessão. Ela também termina sozinha ao fechar a aba.

## Cadastrando documentos

- **Google Drive:** no Drive, clique em *Compartilhar → Acesso geral → Qualquer pessoa com o link* e cole o link no painel. Também funciona com Google Docs, Planilhas e Apresentações (o download sai em PDF).
- **Enviar PDF:** o arquivo vai para a pasta `arquivos/` do repositório. Limite de 25 MB por arquivo. Para arquivos maiores, use o Drive.

Depois de salvar, clique em **QR Code** e escolha:

- **Imprimir A4**: abre uma folha no estilo manual, com título, QR Code no centro e instruções de como escanear. Dá para clicar nos textos e editar antes de imprimir. Use **Imprimir / Salvar PDF**.
- **Baixar PNG**: só o QR Code com o título embaixo, para usar em etiquetas ou outros materiais.
- **Copiar link**.

## Observações

- Depois de salvar, o GitHub Pages leva cerca de 1 minuto para publicar a mudança.
- O repositório é público, então os PDFs enviados e a lista `data/documentos.json` podem ser vistos por qualquer pessoa. Não use para documentos sigilosos.
- Desmarcar **Ativo** bloqueia o acesso sem invalidar o QR Code. **Excluir** remove o documento de vez, e o QR Code para de funcionar.
- Desmarcar **Mostrar na página inicial** esconde o documento da lista. Ele continua acessível pelo QR Code.
