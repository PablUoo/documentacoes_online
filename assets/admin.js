const $ = s => document.querySelector(s);
const SESSAO_KEY = 'docqr.sessao';
const ACESSO_PATH = 'data/acesso.json';
const ITERACOES = 600000;
const MAX_MB = 25;

let cfg = {};
let docs = [];
let docsSha = null;
let editando = null;

// ---------- Sessão ----------
// Por padrão a sessão (com o token já decifrado) dura só enquanto a aba estiver aberta.
// Com "Manter conectado", fica salva neste navegador até clicar em Sair.

function lerSessao() {
  for (const s of [sessionStorage, localStorage]) {
    try { const c = JSON.parse(s.getItem(SESSAO_KEY)); if (c) return c; } catch { /* sem storage */ }
  }
  return {};
}
function gravarSessao(c, lembrar) {
  limparSessao();
  try { (lembrar ? localStorage : sessionStorage).setItem(SESSAO_KEY, JSON.stringify(c)); } catch { /* sem storage */ }
}
function sessaoLembrada() {
  try { return !!localStorage.getItem(SESSAO_KEY); } catch { return false; }
}
function limparSessao() {
  for (const s of [sessionStorage, localStorage]) {
    try { s.removeItem(SESSAO_KEY); } catch { /* sem storage */ }
  }
}

// ---------- Criptografia do token ----------
// O token é cifrado com AES-GCM; a chave vem de usuário + senha via PBKDF2.
// O arquivo data/acesso.json é público, mas sem usuário e senha o token não pode ser lido.

function b64ParaBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function derivarChave(usuario, senha, salt, iteracoes) {
  const segredo = new TextEncoder().encode(usuario.trim().toLowerCase() + '\n' + senha);
  const base = await crypto.subtle.importKey('raw', segredo, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iteracoes, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function cifrarAcesso(usuario, senha, dados) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chave = await derivarChave(usuario, senha, salt, ITERACOES);
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, new TextEncoder().encode(JSON.stringify(dados)));
  return { versao: 1, iteracoes: ITERACOES, salt: bytesParaB64(salt), iv: bytesParaB64(iv), dados: bytesParaB64(new Uint8Array(cifrado)) };
}

async function decifrarAcesso(usuario, senha, acesso) {
  const chave = await derivarChave(usuario, senha, b64ParaBytes(acesso.salt), acesso.iteracoes);
  const aberto = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ParaBytes(acesso.iv) }, chave, b64ParaBytes(acesso.dados));
  return JSON.parse(new TextDecoder().decode(aberto));
}

// Lido sem token. Pela API do GitHub o arquivo aparece na hora (o site publicado demora ~1 min);
// se a API falhar (ex.: limite de requisições), usa a cópia do site.
async function buscarAcesso() {
  const fixa = configFixa();
  if (fixa) {
    try {
      const url = `https://api.github.com/repos/${fixa.owner}/${fixa.repo}/contents/${ACESSO_PATH}?ref=${encodeURIComponent(fixa.branch)}&t=${Date.now()}`;
      const r = await fetch(url, { headers: { Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' });
      if (r.ok) return r.json();
      if (r.status === 404) return null;
    } catch { /* tenta pelo site */ }
  }
  const r = await fetch(ACESSO_PATH + '?t=' + Date.now(), { cache: 'no-store' });
  return r.ok ? r.json() : null;
}

async function salvarAcesso(usuario, senha) {
  const acesso = await cifrarAcesso(usuario, senha, cfg);
  const conteudo = new TextEncoder().encode(JSON.stringify(acesso, null, 2) + '\n');
  const atual = await gh(ACESSO_PATH, { allow404: true });
  const body = { message: 'Atualiza acesso do painel', content: bytesParaB64(conteudo), branch: cfg.branch };
  if (atual) body.sha = atual.sha;
  await gh(ACESSO_PATH, { method: 'PUT', body });
}

// Em usuario.github.io/repo/ dá para deduzir usuário e repositório.
function detectarRepo() {
  const h = location.hostname;
  if (!h.endsWith('.github.io')) return {};
  const owner = h.split('.')[0];
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return { owner, repo: seg && !seg.endsWith('.html') ? seg : h };
}

function baseSite() {
  let b = cfg.baseUrl || new URL('./', location.href).href;
  if (!b.endsWith('/')) b += '/';
  return b;
}
function linkDoc(id) {
  return baseSite() + 'doc.html?id=' + encodeURIComponent(id);
}

// ---------- Mensagens ----------

function aviso(texto, tipo = '') {
  $('#msg').innerHTML = texto ? `<div class="aviso ${tipo}">${App.esc(texto)}</div>` : '';
  if (tipo === 'ok') setTimeout(() => { if ($('#msg').textContent === texto) aviso(''); }, 6000);
}

// ---------- API do GitHub ----------

async function gh(path, { method = 'GET', body, allow404 = false } = {}) {
  let url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/` +
    path.split('/').map(encodeURIComponent).join('/');
  if (method === 'GET') url += '?ref=' + encodeURIComponent(cfg.branch);
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  if (r.status === 404 && allow404) return null;
  if (!r.ok) {
    let detalhe = '';
    try { detalhe = (await r.json()).message; } catch { /* sem corpo */ }
    const e = new Error(`GitHub ${r.status}: ${detalhe}`);
    e.status = r.status;
    throw e;
  }
  return r.status === 204 ? null : r.json();
}

function bytesParaB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
function b64ParaTexto(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

async function carregarDocs() {
  const r = await gh(App.DATA_PATH, { allow404: true });
  if (!r) { docs = []; docsSha = null; return; }
  docs = JSON.parse(b64ParaTexto(r.content) || '[]');
  docsSha = r.sha;
}

async function salvarDocs(mensagem) {
  const conteudo = new TextEncoder().encode(JSON.stringify(docs, null, 2) + '\n');
  const body = { message: mensagem, content: bytesParaB64(conteudo), branch: cfg.branch };
  if (docsSha) body.sha = docsSha;
  const r = await gh(App.DATA_PATH, { method: 'PUT', body });
  docsSha = r.content.sha;
}

// Recarrega a lista do repositório antes de alterar, para não sobrescrever mudanças feitas em outro lugar.
async function alterarDocs(mensagem, alteracao) {
  await carregarDocs();
  alteracao(docs);
  await salvarDocs(mensagem);
}

async function enviarPdf(file, id) {
  const nome = file.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.pdf$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'documento';
  const path = `arquivos/${id}-${nome}.pdf`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await gh(path, { method: 'PUT', body: { message: `Envia PDF: ${file.name}`, content: bytesParaB64(bytes), branch: cfg.branch } });
  return path;
}

async function excluirArquivo(path, mensagem) {
  const meta = await gh(path, { allow404: true });
  if (meta) await gh(path, { method: 'DELETE', body: { message: mensagem, sha: meta.sha, branch: cfg.branch } });
}

function novoId() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, b => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-3);
}

// ---------- Telas ----------

function mostrarTela(id) {
  ['#telaEntrar', '#telaLogin', '#telaDocs'].forEach(t => $(t).classList.toggle('oculto', t !== id));
  const logado = id === '#telaDocs';
  $('#btnSair').classList.toggle('oculto', !logado);
  $('#btnTrocarSenha').classList.toggle('oculto', !logado);
  if (!logado) {
    $('#statusRepo').textContent = 'Desconectado';
    $('#statusContagem').textContent = '';
  }
}

function mostrarEntrar() {
  $('#loginSenha').value = '';
  mostrarTela('#telaEntrar');
  $('#loginUsuario').focus();
}

// trocando = já está logado e só quer mudar usuário/senha (o token pode ficar o mesmo).
// Usuário, repositório e branch fixos em assets/config.js (quando preenchido).
function configFixa() {
  const c = window.SITE_CONFIG || {};
  return c.owner && c.repo ? { owner: c.owner, repo: c.repo, branch: c.branch || 'main', baseUrl: c.baseUrl || '' } : null;
}

function mostrarConfig({ trocando = false, primeiroAcesso = false } = {}) {
  const det = configFixa() || detectarRepo();
  $('#camposGithub').classList.toggle('oculto', !!configFixa());
  $('#cfgOwner').required = $('#cfgRepo').required = !configFixa();
  $('#cfgOwner').value = cfg.owner || det.owner || '';
  $('#cfgRepo').value = cfg.repo || det.repo || '';
  $('#cfgBranch').value = cfg.branch || det.branch || 'main';
  $('#cfgToken').value = '';
  $('#cfgToken').required = !trocando;
  $('#cfgToken').placeholder = trocando ? 'Deixe em branco para manter o token atual' : 'github_pat_...';
  $('#cfgBase').value = cfg.baseUrl || det.baseUrl || '';
  $('#novaSenha').value = '';
  $('#novaSenha2').value = '';
  $('#tituloConfig').textContent = trocando ? 'Trocar usuário e senha' : primeiroAcesso ? 'Primeiro acesso' : 'Configurar acesso';
  $('#btnCancelarConfig').classList.toggle('oculto', primeiroAcesso);
  $('#campoLembrarConfig').classList.toggle('oculto', trocando);
  $('#formLogin').dataset.trocando = trocando ? '1' : '';
  mostrarTela('#telaLogin');
}

async function conectar() {
  aviso('Conectando...');
  try {
    await carregarDocs();
    mostrarTela('#telaDocs');
    aviso('');
    renderLista();
    return true;
  } catch (e) {
    const dicas = { 401: 'Token inválido ou expirado. Configure o acesso de novo com um token novo.', 403: 'O token não tem permissão neste repositório.', 404: 'Repositório ou branch não encontrado (ou o token não tem acesso a ele).' };
    aviso(dicas[e.status] || e.message, 'erro');
    return false;
  }
}

async function entrar(ev) {
  ev.preventDefault();
  const btn = $('#btnEntrar');
  btn.disabled = true;
  btn.textContent = 'Entrando...';
  try {
    const acesso = await buscarAcesso();
    if (!acesso) { mostrarConfig({ primeiroAcesso: true }); return; }
    try {
      cfg = await decifrarAcesso($('#loginUsuario').value, $('#loginSenha').value, acesso);
    } catch {
      aviso('Usuário ou senha inválidos.', 'erro');
      $('#loginSenha').value = '';
      $('#loginSenha').focus();
      return;
    }
    gravarSessao(cfg, $('#lembrar').checked);
    if (!(await conectar())) { limparSessao(); mostrarEntrar(); }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

async function salvarConfig(ev) {
  ev.preventDefault();
  const trocando = !!$('#formLogin').dataset.trocando;
  const usuario = $('#novoUsuario').value.trim();
  const senha = $('#novaSenha').value;
  if (senha !== $('#novaSenha2').value) { aviso('As senhas não conferem.', 'erro'); return; }

  const anterior = cfg;
  cfg = {
    owner: $('#cfgOwner').value.trim(),
    repo: $('#cfgRepo').value.trim(),
    branch: $('#cfgBranch').value.trim() || 'main',
    token: $('#cfgToken').value.trim() || (trocando ? anterior.token : ''),
    baseUrl: $('#cfgBase').value.trim(),
  };

  const btn = $('#btnSalvarAcesso');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    if (!(await conectar())) { cfg = anterior; return; }
    await salvarAcesso(usuario, senha);
    gravarSessao(cfg, trocando ? sessaoLembrada() : $('#lembrarConfig').checked);
    aviso('Acesso salvo! Nas próximas vezes, entre com o usuário e a senha.', 'ok');
  } catch (e) {
    aviso('Erro ao salvar o acesso: ' + e.message, 'erro');
    mostrarTela('#telaLogin');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar e entrar';
  }
}

function renderLista() {
  const termo = $('#busca').value.trim().toLowerCase();
  const filtrados = docs
    .filter(d => !termo || (d.titulo + ' ' + (d.descricao || '')).toLowerCase().includes(termo))
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
  $('#lista').innerHTML = filtrados.map(d => `
    <li>
      <div class="info">
        <div class="titulo">${App.esc(d.titulo)}</div>
        <div class="small">
          <span class="tag">${d.tipo === 'arquivo' ? 'PDF no site' : 'Link'}</span>
          ${d.ativo === false ? '<span class="tag off">Desativado</span>' : ''}
          ${d.listar === false ? '<span class="tag">Oculto da lista</span>' : ''}
        </div>
      </div>
      <div class="botoes">
        <button class="btn primario" data-acao="qr" data-id="${d.id}">QR Code</button>
        <button class="btn" data-acao="editar" data-id="${d.id}">Editar</button>
        <button class="btn perigo" data-acao="excluir" data-id="${d.id}">Excluir</button>
      </div>
    </li>`).join('');
  $('#statusRepo').textContent = `⎇ ${cfg.owner}/${cfg.repo} · ${cfg.branch}`;
  $('#statusContagem').textContent = `${docs.length} documento${docs.length === 1 ? '' : 's'}`;
  $('#vazio').textContent = docs.length ? (filtrados.length ? '' : 'Nada encontrado.') : 'Nenhum documento ainda. Clique em “+ Novo documento”.';
}

// ---------- Formulário ----------

function atualizarTipo() {
  const tipo = document.querySelector('input[name=fTipo]:checked').value;
  $('#campoLink').classList.toggle('oculto', tipo !== 'link');
  $('#campoArquivo').classList.toggle('oculto', tipo !== 'arquivo');
}

function abrirForm(doc = null) {
  editando = doc;
  $('#dlgDocTitulo').textContent = doc ? 'Editar documento' : 'Novo documento';
  $('#fTitulo').value = doc?.titulo || '';
  $('#fDescricao').value = doc?.descricao || '';
  document.querySelector(`input[name=fTipo][value=${doc?.tipo || 'link'}]`).checked = true;
  $('#fUrl').value = doc?.url || '';
  $('#fArquivo').value = '';
  $('#arquivoAtual').textContent = doc?.arquivo ? `Arquivo atual: ${doc.arquivo} (envie outro só se quiser substituir)` : '';
  $('#fAtivo').checked = doc ? doc.ativo !== false : true;
  $('#fListar').checked = doc ? doc.listar !== false : true;
  atualizarTipo();
  $('#dlgDoc').showModal();
}

async function salvarForm(ev) {
  ev.preventDefault();
  const tipo = document.querySelector('input[name=fTipo]:checked').value;
  const titulo = $('#fTitulo').value.trim();
  const url = $('#fUrl').value.trim();
  const file = $('#fArquivo').files[0];

  if (!titulo) return;
  if (tipo === 'link' && !url) { alert('Informe o link do documento.'); return; }
  if (tipo === 'arquivo' && !file && !editando?.arquivo) { alert('Selecione um arquivo PDF.'); return; }
  if (file && file.size > MAX_MB * 1024 * 1024) {
    alert(`O arquivo tem ${(file.size / 1048576).toFixed(1)} MB. O limite é ${MAX_MB} MB — para arquivos maiores, use um link do Google Drive.`);
    return;
  }

  const btn = $('#btnSalvar');
  btn.disabled = true;
  btn.textContent = file ? 'Enviando PDF...' : 'Salvando...';
  try {
    const id = editando?.id || novoId();
    const agora = new Date().toISOString();
    let arquivo = tipo === 'arquivo' ? editando?.arquivo : undefined;
    const arquivoAntigo = editando?.arquivo;

    if (tipo === 'arquivo' && file) arquivo = await enviarPdf(file, id);

    const registro = {
      id, titulo,
      descricao: $('#fDescricao').value.trim(),
      tipo,
      ...(tipo === 'link' ? { url } : { arquivo }),
      ativo: $('#fAtivo').checked,
      listar: $('#fListar').checked,
      criadoEm: editando?.criadoEm || agora,
      atualizadoEm: agora,
    };

    await alterarDocs(`${editando ? 'Atualiza' : 'Adiciona'} documento: ${titulo}`, lista => {
      const i = lista.findIndex(d => d.id === id);
      if (i >= 0) lista[i] = registro; else lista.push(registro);
    });

    // Remove o PDF antigo se ele foi substituído ou se a origem virou link.
    if (arquivoAntigo && arquivoAntigo !== arquivo) {
      await excluirArquivo(arquivoAntigo, `Remove PDF antigo de: ${titulo}`).catch(() => {});
    }

    $('#dlgDoc').close();
    renderLista();
    aviso('Salvo! O site público é atualizado pelo GitHub Pages em cerca de 1 minuto.', 'ok');
    if (!editando) abrirQr(registro);
  } catch (e) {
    alert('Erro ao salvar: ' + e.message + (e.status === 409 ? '\nO repositório mudou enquanto você editava. Tente de novo.' : ''));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function excluirDoc(doc) {
  if (!confirm(`Excluir “${doc.titulo}”?\nO QR Code deste documento deixará de funcionar.\n\nSe quiser só bloquear temporariamente, use “Editar” e desmarque “Ativo”.`)) return;
  aviso('Excluindo...');
  try {
    await alterarDocs(`Remove documento: ${doc.titulo}`, lista => {
      const i = lista.findIndex(d => d.id === doc.id);
      if (i >= 0) lista.splice(i, 1);
    });
    if (doc.arquivo) await excluirArquivo(doc.arquivo, `Remove PDF de: ${doc.titulo}`).catch(() => {});
    renderLista();
    aviso('Documento excluído.', 'ok');
  } catch (e) {
    aviso('Erro ao excluir: ' + e.message, 'erro');
  }
}

// ---------- QR Code ----------

let qrAtual = null;

function abrirQr(doc) {
  const link = linkDoc(doc.id);
  qrAtual = { doc, link };
  $('#qrTitulo').textContent = doc.titulo;
  $('#qrLink').textContent = link;
  $('#btnAbrirLink').href = link;
  const box = $('#qrBox');
  box.innerHTML = '';
  const img = new Image();
  img.src = App.qrCanvas(link, 520).toDataURL('image/png');
  img.width = 260;
  img.alt = 'QR Code';
  box.appendChild(img);
  if (/^(file:|http:\/\/(localhost|127\.0\.0\.1))/.test(link)) {
    $('#qrLink').textContent += '  ⚠ endereço local — configure a “URL pública do site” em Sair → Conectar.';
  }
  $('#dlgQr').showModal();
}

// PNG em alta resolução com o título embaixo, pronto para imprimir.
function baixarQr() {
  const { doc, link } = qrAtual;
  const tam = 1000, margem = 60, alturaTexto = 140;
  const qr = App.qrCanvas(link, tam);
  const c = document.createElement('canvas');
  c.width = tam + margem * 2;
  c.height = tam + margem * 2 + alturaTexto;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(qr, margem, margem);
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  let fonte = 56;
  ctx.font = `600 ${fonte}px system-ui, sans-serif`;
  while (ctx.measureText(doc.titulo).width > c.width - margem * 2 && fonte > 24) {
    fonte -= 2;
    ctx.font = `600 ${fonte}px system-ui, sans-serif`;
  }
  ctx.fillText(doc.titulo, c.width / 2, tam + margem + 90, c.width - margem * 2);
  const a = document.createElement('a');
  a.download = 'qrcode-' + doc.titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
  a.href = c.toDataURL('image/png');
  a.click();
}

function imprimirA4() {
  App.imprimirA4(qrAtual.doc, qrAtual.link);
}

async function copiarLink() {
  try {
    await navigator.clipboard.writeText(qrAtual.link);
    $('#btnCopiar').textContent = 'Copiado!';
  } catch {
    prompt('Copie o link:', qrAtual.link);
  }
  setTimeout(() => { $('#btnCopiar').textContent = 'Copiar link'; }, 1500);
}

// ---------- Eventos ----------

$('#formEntrar').addEventListener('submit', entrar);
$('#formLogin').addEventListener('submit', salvarConfig);
$('#lnkConfigurar').addEventListener('click', ev => { ev.preventDefault(); aviso(''); mostrarConfig(); });
$('#btnTrocarSenha').addEventListener('click', () => { aviso(''); mostrarConfig({ trocando: true }); });
$('#btnCancelarConfig').addEventListener('click', () => {
  aviso('');
  if (cfg.token) mostrarTela('#telaDocs'); else mostrarEntrar();
});

$('#btnSair').addEventListener('click', () => {
  cfg = {};
  limparSessao();
  aviso('');
  mostrarEntrar();
});

$('#btnNovo').addEventListener('click', () => abrirForm());
$('#busca').addEventListener('input', renderLista);
$('#lista').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-acao]');
  if (!b) return;
  const doc = docs.find(d => d.id === b.dataset.id);
  if (!doc) return;
  if (b.dataset.acao === 'qr') abrirQr(doc);
  if (b.dataset.acao === 'editar') abrirForm(doc);
  if (b.dataset.acao === 'excluir') excluirDoc(doc);
});

document.querySelectorAll('input[name=fTipo]').forEach(r => r.addEventListener('change', atualizarTipo));
$('#formDoc').addEventListener('submit', salvarForm);
$('#btnCancelar').addEventListener('click', () => $('#dlgDoc').close());
$('#btnBaixarQr').addEventListener('click', baixarQr);
$('#btnImprimir').addEventListener('click', imprimirA4);
$('#btnCopiar').addEventListener('click', copiarLink);
$('#btnFecharQr').addEventListener('click', () => $('#dlgQr').close());

// ---------- Início ----------

// Remove o token salvo em texto puro pela versão anterior do painel.
try { localStorage.removeItem('docqr.config'); } catch { /* sem storage */ }

(async () => {
  cfg = lerSessao();
  if (cfg.token && (await conectar())) return;
  cfg = {};
  limparSessao();
  const acesso = await buscarAcesso().catch(() => null);
  if (acesso) mostrarEntrar(); else mostrarConfig({ primeiroAcesso: true });
})();
