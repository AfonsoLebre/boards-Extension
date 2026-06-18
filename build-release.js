// Monta os artefactos de distribuição a partir do servidor MCP já bundlado.
//
//   node build-release.js
//
// Produz em release-build/:
//   - anturio-boards.mcpb              -> Claude Desktop (1-clique)
//   - anturio-boards-claude-code/      -> pasta para zipar (instalador Claude Code)
//
// Requer: node 18+. Usa `npx @anthropic-ai/mcpb` para empacotar o .mcpb.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'release-build');
const SERVER_BUNDLE = path.join(ROOT, 'mcp-server', 'dist', 'index.js');
const REL = path.join(ROOT, 'release');

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function copy(from, to) { mkdirp(path.dirname(to)); fs.copyFileSync(from, to); }

// 1) (re)bundla o servidor MCP num único index.js self-contained
console.log('[release] a compilar o servidor MCP (node build.js)...');
execFileSync(process.execPath, [path.join(ROOT, 'build.js')], { stdio: 'inherit' });
if (!fs.existsSync(SERVER_BUNDLE)) {
  console.error('[release] ERRO: ' + SERVER_BUNDLE + ' nao foi gerado.');
  process.exit(1);
}

rmrf(OUT);
mkdirp(OUT);

// 2) pasta do instalador Claude Code
const CC = path.join(OUT, 'anturio-boards-claude-code');
mkdirp(CC);
copy(SERVER_BUNDLE, path.join(CC, 'index.js'));
copy(path.join(REL, 'SKILL.md'), path.join(CC, 'SKILL.md'));
copy(path.join(REL, 'install.sh'), path.join(CC, 'install.sh'));
copy(path.join(REL, 'install.ps1'), path.join(CC, 'install.ps1'));
copy(path.join(REL, 'README-USER.md'), path.join(CC, 'README.md'));
console.log('[release] pasta Claude Code pronta: ' + CC);

// 3) bundle .mcpb para Claude Desktop
const MCPB_SRC = path.join(OUT, 'mcpb');
mkdirp(path.join(MCPB_SRC, 'server'));
copy(path.join(REL, 'mcpb', 'manifest.json'), path.join(MCPB_SRC, 'manifest.json'));
copy(SERVER_BUNDLE, path.join(MCPB_SRC, 'server', 'index.js'));

const mcpbOut = path.join(OUT, 'anturio-boards.mcpb');
console.log('[release] a empacotar .mcpb (npx @anthropic-ai/mcpb pack)...');
// shell:true para o Windows resolver npx.cmd; aspas para paths com espacos.
const cmd = `npx --yes @anthropic-ai/mcpb pack "${MCPB_SRC}" "${mcpbOut}"`;
const r = spawnSync(cmd, { stdio: 'inherit', shell: true });
if (r.status !== 0) {
  console.error('[release] ERRO: falha ao empacotar o .mcpb.');
  process.exit(1);
}

console.log('\n[release] feito.');
console.log('  Desktop     : ' + mcpbOut);
console.log('  Claude Code : ' + CC + '  (zipar esta pasta)');
