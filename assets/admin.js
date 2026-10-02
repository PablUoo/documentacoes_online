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
// Formato do data/acesso.json (versão 2):
// - "cofre": token e configuração, cifrados (AES-GCM) com uma chave mestra aleatória;
// - "usuarios": para cada admin, a chave mestra cifrada com uma chave derivada de usuário + senha (PBKDF2).
// Assim cada admin tem a própria senha, e trocar o token não quebra o acesso dos outros.
// O arquivo é público, mas sem um usuário e senha válidos nada pode ser lido.
// A versão 1 (um usuário só, token cifrado direto pela senha) é migrada no login.

const utf8 = s => new TextEncoder().encode(s);
const deUtf8 = b => new TextDecoder().decode(b);
const normalizarUsuario = u => u.trim().toLowerCase();

function b64ParaBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function derivarChave(usuario, senha, salt, iteracoes) {
  const base = await crypto.subtle.importKey('raw', utf8(normalizarUsuario(usuario) + '\n' + senha), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iteracoes, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function importarMestra(bytes) {
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function cifrarBytes(chave, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, bytes);
  return { iv: bytesParaB64(iv), dados: bytesParaB64(new Uint8Array(cifrado)) };
}

async function decifrarBytes(chave, { iv, dados }) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ParaBytes(iv) }, chave, b64ParaBytes(dados)));
}

// Só o que precisa ficar no cofre (sem dados da sessão).
function credenciais() {
  const { owner, repo, branch, token, baseUrl } = cfg;
  return { owner, repo, branch, token, baseUrl };
}

async function montarCofre(mestra) {
  return cifrarBytes(await importarMestra(mestra), utf8(JSON.stringify(credenciais())));
}

async function entradaUsuario(usuario, senha, mestra) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const chave = await derivarChave(usuario, senha, salt, ITERACOES);
  return { iteracoes: ITERACOES, salt: bytesParaB64(salt), ...(await cifrarBytes(chave, mestra)), criadoEm: new Date().toISOString() };
}

// Devolve as credenciais e a chave mestra (null se o arquivo ainda for da versão 1).
async function abrirAcesso(usuario, senha, acesso) {
  if (acesso.versao === 2) {
    const e = acesso.usuarios?.[normalizarUsuario(usuario)];
    if (!e) throw new Error('usuário não encontrado');
    const mestra = await decifrarBytes(await derivarChave(usuario, senha, b64ParaBytes(e.salt), e.iteracoes), e);
    const cred = JSON.parse(deUtf8(await decifrarBytes(await importarMestra(mestra), acesso.cofre)));
    return { cred, mestra };
  }
  const chave = await derivarChave(usuario, senha, b64ParaBytes(acesso.salt), acesso.iteracoes);
  return { cred: JSON.parse(deUtf8(await decifrarBytes(chave, acesso))), mestra: null };
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

async function lerAcessoRepo() {
  const r = await gh(ACESSO_PATH, { allow404: true });
  return r ? { acesso: JSON.parse(b64ParaTexto(r.content)), sha: r.sha } : { acesso: null, sha: null };
}

async function gravarAcessoRepo(acesso, sha, mensagem) {
  const body = { message: mensagem, content: bytesParaB64(utf8(JSON.stringify(acesso, null, 2) + '\n')), branch: cfg.branch };
  if (sha) body.sha = sha;
  await gh(ACESSO_PATH, { method: 'PUT', body });
}

// Cria o acesso do zero (primeiro acesso, recuperação ou migração): só este usuário fica cadastrado.
async function criarAcessoNovo(usuario, senha) {
  const mestra = crypto.getRandomValues(new Uint8Array(32));
  const nome = normalizarUsuario(usuario);
  const acesso = { versao: 2, cofre: await montarCofre(mestra), usuarios: { [nome]: await entradaUsuario(nome, senha, mestra) } };
  const { sha } = await lerAcessoRepo();
  await gravarAcessoRepo(acesso, sha, `Cria acesso do painel (${nome})`);
  cfg.usuario = nome;
  cfg.mestra = bytesParaB64(mestra);
}

// Altera o acesso existente usando a chave mestra da sessão.
async function alterarAcesso(mensagem, alteracao) {
  const { acesso, sha } = await lerAcessoRepo();
  if (!acesso || acesso.versao !== 2 || !cfg.mestra) throw new Error('Acesso em formato antigo. Saia e entre de novo para atualizar.');
  await alteracao(acesso, b64ParaBytes(cfg.mestra));
  await gravarAcessoRepo(acesso, sha, mensagem);
  return acesso;
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
  $('#btnUsuarios').classList.toggle('oculto', !logado);
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
  $('#novoUsuario').value = trocando ? (cfg.usuario || '') : '';
  $('#tituloConfig').textContent = trocando ? 'Trocar usuário e senha' : primeiroAcesso ? 'Primeiro acesso' : 'Configurar acesso de novo';
  $('#textoConfig').textContent = trocando
    ? 'Altera só o seu usuário e senha. Se informar um token novo, ele passa a valer para todos os admins.'
    : primeiroAcesso
      ? 'O token do GitHub fica salvo no repositório criptografado. Depois disso, basta entrar com usuário e senha.'
      : 'Recria o acesso com um token válido. Atenção: os outros admins precisarão ser cadastrados de novo.';
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
    const usuario = $('#loginUsuario').value;
    const senha = $('#loginSenha').value;
    let aberto;
    try {
      aberto = await abrirAcesso(usuario, senha, acesso);
    } catch {
      aviso('Usuário ou senha inválidos.', 'erro');
      $('#loginSenha').value = '';
      $('#loginSenha').focus();
      return;
    }
    cfg = { ...aberto.cred, usuario: normalizarUsuario(usuario), mestra: aberto.mestra ? bytesParaB64(aberto.mestra) : null };
    if (!(await conectar())) { cfg = {}; mostrarEntrar(); return; }
    // Arquivo da versão 1: converte para o formato com vários usuários.
    if (!aberto.mestra) await criarAcessoNovo(usuario, senha).catch(() => {});
    gravarSessao(cfg, $('#lembrar').checked);
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

  if (!usuarioValido(usuario)) { aviso(AVISO_USUARIO, 'erro'); return; }

  const anterior = cfg;
  const tokenNovo = $('#cfgToken').value.trim();
  cfg = {
    owner: $('#cfgOwner').value.trim(),
    repo: $('#cfgRepo').value.trim(),
    branch: $('#cfgBranch').value.trim() || 'main',
    token: tokenNovo || (trocando ? anterior.token : ''),
    baseUrl: $('#cfgBase').value.trim(),
    usuario: anterior.usuario,
    mestra: trocando ? anterior.mestra : null,
  };

  const btn = $('#btnSalvarAcesso');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    if (!(await conectar())) { cfg = anterior; if (trocando) mostrarConfig({ trocando }); return; }
    if (trocando && cfg.mestra) {
      // Troca do próprio usuário/senha (e do token, se informado) sem afetar os outros admins.
      const nome = normalizarUsuario(usuario);
      await alterarAcesso(`Atualiza acesso do painel (${nome})`, async (acesso, mestra) => {
        if (tokenNovo) acesso.cofre = await montarCofre(mestra);
        if (anterior.usuario && anterior.usuario !== nome) delete acesso.usuarios[anterior.usuario];
        acesso.usuarios[nome] = await entradaUsuario(nome, senha, mestra);
      });
      cfg.usuario = nome;
    } else {
      await criarAcessoNovo(usuario, senha);
    }
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

// ---------- Dono e compartilhamento ----------
// Cada documento tem um dono (quem criou). Os outros admins só o veem se estiver compartilhado,
// e só o dono edita ou exclui. Documentos antigos, sem dono, ficam visíveis e editáveis por todos
// até alguém salvá-los (aí quem salvou vira o dono).

function ehDono(d) {
  return !d.dono || d.dono === cfg.usuario;
}
function visivelParaMim(d) {
  return ehDono(d) || d.compartilhado === true;
}

function renderLista() {
  const termo = $('#busca').value.trim().toLowerCase();
  const filtro = $('#filtroDono').value;
  const visiveis = docs.filter(visivelParaMim);
  const filtrados = visiveis
    .filter(d => filtro === 'todos' || (filtro === 'meus' ? d.dono === cfg.usuario || !d.dono : d.dono && d.dono !== cfg.usuario))
    .filter(d => !termo || (d.titulo + ' ' + (d.descricao || '')).toLowerCase().includes(termo))
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
  $('#lista').innerHTML = filtrados.map(d => {
    const meu = ehDono(d);
    return `
    <li>
      <div class="info">
        <div class="titulo">${App.esc(d.titulo)}</div>
        <div class="small">
          <span class="tag">${d.tipo === 'arquivo' ? 'PDF no site' : 'Link'}</span>
          ${d.ativo === false ? '<span class="tag off">Desativado</span>' : ''}
          ${d.compartilhado ? '<span class="tag">Compartilhado</span>' : ''}
          ${d.dono && !meu ? `<span class="tag">De ${App.esc(d.dono)}</span>` : ''}
          ${!d.dono ? '<span class="tag">Sem dono</span>' : ''}
        </div>
      </div>
      <div class="botoes">
        <button class="btn primario" data-acao="qr" data-id="${d.id}">QR Code</button>
        ${meu ? `<button class="btn" data-acao="editar" data-id="${d.id}">Editar</button>
        <button class="btn perigo" data-acao="excluir" data-id="${d.id}">Excluir</button>` : '<span class="muted small">Somente leitura</span>'}
      </div>
    </li>`;
  }).join('');
  $('#statusRepo').textContent = `⎇ ${cfg.owner}/${cfg.repo} · ${cfg.branch} · ${cfg.usuario || ''}`;
  $('#statusContagem').textContent = `${visiveis.length} documento${visiveis.length === 1 ? '' : 's'}`;
  $('#vazio').textContent = visiveis.length ? (filtrados.length ? '' : 'Nada encontrado.') : 'Nenhum documento ainda. Clique em “+ Novo documento”.';
}

// ---------- Formulário ----------

function atualizarTipo() {
  const tipo = document.querySelector('input[name=fTipo]:checked').value;
  $('#campoLink').classList.toggle('oculto', tipo !== 'link');
  $('#campoArquivo').classList.toggle('oculto', tipo !== 'arquivo');
}

function abrirForm(doc = null) {
  if (doc && !ehDono(doc)) { alert(`Só ${doc.dono} pode editar este documento.`); return; }
  editando = doc;
  $('#fCompartilhado').checked = !!doc?.compartilhado;
  $('#dlgDocTitulo').textContent = doc ? 'Editar documento' : 'Novo documento';
  $('#fTitulo').value = doc?.titulo || '';
  $('#fDescricao').value = doc?.descricao || '';
  document.querySelector(`input[name=fTipo][value=${doc?.tipo || 'link'}]`).checked = true;
  $('#fUrl').value = doc?.url || '';
  $('#fArquivo').value = '';
  $('#arquivoAtual').textContent = doc?.arquivo ? `Arquivo atual: ${doc.arquivo} (envie outro só se quiser substituir)` : '';
  $('#fAtivo').checked = doc ? doc.ativo !== false : true;
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
      dono: editando?.dono || cfg.usuario,
      compartilhado: $('#fCompartilhado').checked,
      criadoEm: editando?.criadoEm || agora,
      atualizadoEm: agora,
    };

    await alterarDocs(`${editando ? 'Atualiza' : 'Adiciona'} documento: ${titulo} (${cfg.usuario})`, lista => {
      const i = lista.findIndex(d => d.id === id);
      // Confere de novo na versão mais recente, caso o dono tenha mudado nesse meio-tempo.
      if (i >= 0 && !ehDono(lista[i])) throw new Error(`só ${lista[i].dono} pode editar este documento.`);
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
  if (!ehDono(doc)) { alert(`Só ${doc.dono} pode excluir este documento.`); return; }
  if (!confirm(`Excluir “${doc.titulo}”?\nO QR Code deste documento deixará de funcionar.\n\nSe quiser só bloquear temporariamente, use “Editar” e desmarque “Ativo”.`)) return;
  aviso('Excluindo...');
  try {
    await alterarDocs(`Remove documento: ${doc.titulo} (${cfg.usuario})`, lista => {
      const i = lista.findIndex(d => d.id === doc.id);
      if (i >= 0 && !ehDono(lista[i])) throw new Error(`só ${lista[i].dono} pode excluir este documento.`);
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

// ---------- Usuários admin ----------

const AVISO_USUARIO = 'Usuário inválido: use de 2 a 40 letras, números, ponto, hífen, sublinhado ou @, sem espaços.';
function usuarioValido(u) {
  return /^[a-z0-9._@-]{2,40}$/.test(normalizarUsuario(u));
}

async function abrirUsuarios() {
  $('#formUsuario').reset();
  $('#listaUsuarios').innerHTML = '';
  $('#usuariosStatus').textContent = 'Carregando...';
  $('#dlgUsuarios').showModal();
  try {
    const { acesso } = await lerAcessoRepo();
    renderUsuarios(acesso);
  } catch (e) {
    $('#usuariosStatus').textContent = 'Erro ao carregar: ' + e.message;
  }
}

function renderUsuarios(acesso) {
  if (!acesso || acesso.versao !== 2) {
    $('#usuariosStatus').textContent = 'Acesso em formato antigo. Saia e entre de novo para atualizar.';
    return;
  }
  const nomes = Object.keys(acesso.usuarios).sort();
  $('#listaUsuarios').innerHTML = nomes.map(n => {
    const voce = n === cfg.usuario;
    const desde = acesso.usuarios[n].criadoEm ? new Date(acesso.usuarios[n].criadoEm).toLocaleDateString('pt-BR') : '';
    return `
      <li>
        <div class="info" style="display:block">
          <div class="titulo">${App.esc(n)} ${voce ? '<span class="tag">você</span>' : ''}</div>
          ${desde ? `<div class="muted small">Desde ${desde}</div>` : ''}
        </div>
        ${voce ? '' : `<button class="btn perigo" data-remover="${App.esc(n)}">Remover</button>`}
      </li>`;
  }).join('');
  $('#usuariosStatus').textContent = `${nomes.length} usuário${nomes.length === 1 ? '' : 's'}`;
}

async function criarUsuario(ev) {
  ev.preventDefault();
  const nome = normalizarUsuario($('#uNome').value);
  const senha = $('#uSenha').value;
  if (!usuarioValido(nome)) { alert(AVISO_USUARIO); return; }
  if (senha !== $('#uSenha2').value) { alert('As senhas não conferem.'); return; }
  const btn = $('#btnCriarUsuario');
  btn.disabled = true;
  btn.textContent = 'Criando...';
  try {
    const acesso = await alterarAcesso(`Adiciona usuário admin: ${nome}`, async (acesso, mestra) => {
      if (acesso.usuarios[nome]) throw new Error(`O usuário “${nome}” já existe.`);
      acesso.usuarios[nome] = await entradaUsuario(nome, senha, mestra);
    });
    $('#formUsuario').reset();
    renderUsuarios(acesso);
  } catch (e) {
    alert('Erro ao criar usuário: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar usuário';
  }
}

async function removerUsuario(nome) {
  if (!confirm(`Remover o usuário “${nome}”?\n\nEle não vai mais conseguir entrar. Se ele estiver com o painel aberto agora, a sessão dele continua até sair; para cortar na hora, troque também o token do GitHub.`)) return;
  try {
    const acesso = await alterarAcesso(`Remove usuário admin: ${nome}`, async acesso => {
      delete acesso.usuarios[nome];
    });
    renderUsuarios(acesso);
  } catch (e) {
    alert('Erro ao remover usuário: ' + e.message);
  }
}

// ---------- Eventos ----------

$('#formEntrar').addEventListener('submit', entrar);
$('#formLogin').addEventListener('submit', salvarConfig);
$('#lnkConfigurar').addEventListener('click', ev => { ev.preventDefault(); aviso(''); mostrarConfig(); });
$('#btnTrocarSenha').addEventListener('click', () => { aviso(''); mostrarConfig({ trocando: true }); });
$('#btnUsuarios').addEventListener('click', abrirUsuarios);
$('#formUsuario').addEventListener('submit', criarUsuario);
$('#btnFecharUsuarios').addEventListener('click', () => $('#dlgUsuarios').close());
$('#listaUsuarios').addEventListener('click', ev => {
  const b = ev.target.closest('[data-remover]');
  if (b) removerUsuario(b.dataset.remover);
});
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
$('#filtroDono').addEventListener('change', renderLista);
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
