// Language for the computer-side commands and logs. The phone app uses the phone's system language.
// LC_ALL / LC_MESSAGES override this. Otherwise we read the OS UI language, because launchd
// and Windows often leave LANG unset even when the system language is Chinese.
import { execFileSync } from 'node:child_process';

function read(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 2000, windowsHide: true }).trim();
  } catch { return ''; }
}

function osUiLocale() {
  if (process.platform === 'darwin') {
    const m = /"([^"]+)"/.exec(read('defaults', ['read', '-g', 'AppleLanguages']));
    return m ? m[1] : '';
  }
  if (process.platform === 'win32') {
    return read('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[cultureinfo]::CurrentUICulture.Name']);
  }
  return '';
}

function systemLocale() {
  const override = process.env.LC_ALL || process.env.LC_MESSAGES || '';
  if (override && !/^(C|POSIX)(\.|$)/.test(override)) return override;
  const ui = osUiLocale();
  if (ui) return ui;
  const lang = process.env.LANG || '';
  if (lang && !/^(C|POSIX)(\.|$)/.test(lang)) return lang;
  try { return Intl.DateTimeFormat().resolvedOptions().locale || ''; } catch { return ''; }
}

const raw = systemLocale().replaceAll('_', '-');
export const en = !/^zh\b/i.test(raw);
export const t = (zh, enText) => (en ? enText : zh);

// Publishing must stay on github.com. GH_HOST or an enterprise token would send the app elsewhere.
export function ghEnv(base = process.env) {
  const env = { ...base, GH_HOST: 'github.com' };
  delete env.GH_ENTERPRISE_TOKEN;
  delete env.GITHUB_ENTERPRISE_TOKEN;
  return env;
}

// No "." / ".." segments, so a repo or file name cannot walk out of the GitHub contents path.
export const REPO_OK = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const FILE_OK = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]*$/;
