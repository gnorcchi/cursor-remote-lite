// Language for the computer-side commands and logs. The phone app has its own setting.
const raw = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
export const en = !/^zh/i.test(raw.split('.')[0]);
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
