// Interactive first-run setup: checks dependencies, creates the GitHub Pages app, installs the service.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { t, ghEnv, REPO_OK } from './locale.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(os.homedir(), '.cursor-remote-lite');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const isMac = process.platform === 'darwin';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, def = '') => (await rl.question(def ? `${q} [${def}] ` : `${q} `)).trim() || def;
const yes = async (q, def = 'y') => /^y/i.test(await ask(`${q} (y/n)`, def));
const has = cmd => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, {
  encoding: 'utf8',
  ...opts,
  env: cmd === 'gh' ? ghEnv() : process.env,
});
// readline keeps the TTY in raw mode even when paused; child prompts need cooked mode to see Enter.
const interactive = (cmd, args) => {
  rl.pause();
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  const r = run(cmd, args, { stdio: 'inherit' });
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  rl.resume();
  return r;
};

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const config = (() => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } })();
const saveConfig = () => fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });

console.log(t('\n== Cursor Remote 安装向导 ==\n', '\n== Cursor Remote setup ==\n'));

console.log(t('1/4 检查依赖', '1/4 Dependencies'));
const missing = [];
if (!has('cloudflared')) missing.push(['cloudflared', isMac ? 'brew install cloudflared' : 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/']);
if (!has('gh')) missing.push(['gh', isMac ? 'brew install gh' : 'https://cli.github.com/']);
for (const [name, how] of missing) console.log(t(`  缺少 ${name}：${how}`, `  Missing ${name}: ${how}`));
if (missing.length && !await yes(t('  缺少的工具只影响「外网访问 / 固定地址」，是否继续？', '  The missing tools only affect access from outside your network and the fixed address. Continue?'))) process.exit(1);
if (!missing.length) console.log(t('  cloudflared、gh 都已安装', '  cloudflared and gh are both installed'));

console.log(t('\n2/4 固定地址（手机 App）', '\n2/4 Fixed address (phone app)'));
console.log(t(
  '  在你的 GitHub 上建一个公开仓库，用 GitHub Pages 托管手机 App。',
  '  Create a public repository on your GitHub account and host the phone app with GitHub Pages.',
));
console.log(t(
  '  仓库里只有 App 页面和加密过的电脑地址；解密钥匙只在配对时交给你的手机。',
  '  The repository holds only the app pages and your computer\'s encrypted address. The key is given to your phone only when you pair.',
));
if (has('gh') && await yes(t('  要设置吗？', '  Set this up?'))) {
  if (run('gh', ['auth', 'status']).status !== 0) {
    console.log(t('  先登录 GitHub：', '  Sign in to GitHub first:'));
    if (interactive('gh', ['auth', 'login', '--hostname', 'github.com']).status !== 0) {
      console.log(t(
        '  GitHub 登录没有完成，可以单独运行 gh auth login 后再运行 npm run setup',
        '  GitHub sign-in did not finish. Run gh auth login, then npm run setup again.',
      ));
      process.exit(1);
    }
  }
  const login = run('gh', ['api', '--hostname', 'github.com', 'user', '--jq', '.login']).stdout.trim();
  const name = await ask(t('  仓库名', '  Repository name'), config.publishRepo?.split('/')[1] || 'cursor-remote-app');
  const repo = `${login}/${name}`;
  if (!REPO_OK.test(repo)) {
    console.log(t(
      '  仓库名只能包含字母、数字、点、下划线和连字符，而且只会创建在 github.com 上。',
      '  The repository name can only contain letters, numbers, dots, underscores and hyphens, and it is created on github.com only.',
    ));
    process.exit(1);
  }
  if (run('gh', ['repo', 'view', repo]).status !== 0) {
    const r = run('gh', ['repo', 'create', repo, '--public', '--description', 'My Cursor Remote phone app']);
    if (r.status !== 0) { console.log(r.stderr); process.exit(1); }
  }
  // Pages needs at least one commit before it can be enabled; the server uploads the rest on start.
  const index = fs.readFileSync(path.join(DIR, 'app', 'index.html'));
  const sha = run('gh', ['api', '--hostname', 'github.com', `repos/${repo}/contents/index.html`, '--jq', '.sha']).stdout.trim();
  run('gh', ['api', '--hostname', 'github.com', '-X', 'PUT', `repos/${repo}/contents/index.html`, '--input', '-'], {
    input: JSON.stringify({ message: 'add app', content: index.toString('base64'), ...(sha ? { sha } : {}) }),
  });
  run('gh', ['api', '--hostname', 'github.com', '-X', 'POST', `repos/${repo}/pages`, '-f', 'source[branch]=main', '-f', 'source[path]=/']);
  config.publishRepo = repo;
  saveConfig();
  console.log(t(
    `  手机 App 地址：https://${login.toLowerCase()}.github.io/${name}/`,
    `  Phone app address: https://${login.toLowerCase()}.github.io/${name}/`,
  ));
}

console.log(t('\n3/4 后台服务', '\n3/4 Background service'));
if (isMac && await yes(t('  设为开机自启（后台常驻，崩溃自动重启）？', '  Start at login (stays running, restarts if it crashes)?'))) {
  run('bash', [path.join(DIR, 'service.sh'), 'install'], { stdio: 'inherit' });
} else {
  console.log(t(
    '  手动启动：npm run public（外网）或 npm start（仅局域网）',
    '  Start it yourself: npm run public (from outside your network) or npm start (LAN only)',
  ));
}

console.log(t('\n4/4 安全', '\n4/4 Security'));
console.log(t(
  '  手机通过「配对」登录，不用密码：每台手机在电脑上扫一次码即可。',
  '  The phone signs in by pairing, with no password: each phone scans a code on the computer once.',
));
if (await yes(t('  要再加一层 Authenticator 二次验证吗（Google / Microsoft Authenticator）？', '  Also require an Authenticator app (Google Authenticator, Microsoft Authenticator)?'), 'n')) {
  interactive('node', [path.join(DIR, 'twofa.mjs')]);
}

console.log(t(`
完成！还差两步：
  1. 用 ${isMac ? './start-cursor.sh' : 'powershell -ExecutionPolicy Bypass -File .\\start-cursor.ps1'} 重启 Cursor（带调试端口），手机才能控制它。
  2. 运行 npm run pair，用手机扫码配对。以后每台新手机都这样配对一次。`, `
Done. Two steps left:
  1. Restart Cursor with ${isMac ? './start-cursor.sh' : 'powershell -ExecutionPolicy Bypass -File .\\start-cursor.ps1'} so the phone can control it (this turns on the debugging port).
  2. Run npm run pair and scan the code with your phone. Do that once for each new phone.`));
rl.close();
