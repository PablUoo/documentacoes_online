# Documentos Online (QR Code)

Site estático para o GitHub Pages: você cadastra documentos PDF (link do Google Drive ou upload direto), e cada um ganha um QR Code que abre uma página com visualização e botão de download.

## Páginas

| Página | Para quê |
|---|---|
| `index.html` | Lista pública dos documentos (com busca) |
| `doc.html?id=...` | Página do documento: é o endereço que o QR Code abre |
| `admin.html` | Painel para cadastrar, editar, excluir e gerar os QR Codes |

O QR Code aponta para a página `doc.html?id=...`, e não direto para o arquivo. Assim você pode **trocar o PDF ou o link do Drive sem reimprimir o QR Code**, e desativar o documento quando quiser.

## Como publicar

1. Crie um repositório **público** no GitHub (ex.: `documentacoes_online`) e envie todos os arquivos desta pasta.
2. No repositório: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`** → Save.
3. Em ~1 minuto o site fica em `https://SEU_USUARIO.github.io/documentacoes_online/`.

## Como criar o token do painel admin

O painel salva tudo direto no repositório pela API do GitHub. Quem não tem o token não consegue alterar nada.

1. GitHub → foto do perfil → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access:** *Only select repositories* → escolha este repositório.
3. **Permissions → Repository permissions → Contents: Read and write**.
4. Gere e copie o token (`github_pat_...`).
5. Abra `https://SEU_USUARIO.github.io/documentacoes_online/admin.html`, cole o token e conecte. Usuário e repositório são preenchidos sozinhos.

O token fica salvo só no navegador onde você conectou. Use **Sair** para apagá-lo em computadores compartilhados.

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
