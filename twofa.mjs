// npm run 2fa            → turn on authenticator-app verification (Google Authenticator, Microsoft Authenticator, ...)
// npm run 2fa off        → turn it off
// npm run 2fa status
import os from 'node:os';
import readline from 'node:readline/promises';
import qrcode from 'qrcode-terminal';
import { totpConfig, newTotpSecret, totpUri, checkTotp, enableTotp, disableTotp } from './auth.mjs';
import { t } from './locale.mjs';

const cmd = process.argv[2] || 'on';
const cfg = totpConfig();
const rule = days => (days
  ? t(`配对新设备时，以及每台设备每 ${days} 天验证一次`, `when pairing a new device, and again on each device every ${days} days`)
  : t('只在配对新设备时验证', 'only when pairing a new device'));

if (cmd === 'status') {
  console.log(cfg
    ? t(`二次验证：已开启（${rule(cfg.everyDays)}）`, `Two-factor verification: on (${rule(cfg.everyDays)})`)
    : t('二次验证：未开启（运行 npm run 2fa 开启）', 'Two-factor verification: off (run npm run 2fa to turn it on)'));
  process.exit(0);
}
if (cmd === 'off') {
  disableTotp();
  console.log(t('已关闭二次验证。', 'Two-factor verification is off.'));
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
if (cfg && !/^y/i.test(await rl.question(t(
  `已经开启了（${rule(cfg.everyDays)}）。要重新绑定 Authenticator 吗？(y/N) `,
  `Already on (${rule(cfg.everyDays)}). Bind Authenticator again? (y/N) `,
)))) process.exit(0);

const secret = newTotpSecret();
console.log(t(
  '\n1. 手机打开 Authenticator（Google / Microsoft Authenticator 等），扫描下面的二维码：\n',
  '\n1. Open Authenticator on your phone (Google Authenticator, Microsoft Authenticator, ...) and scan this QR code:\n',
));
qrcode.generate(totpUri(secret, os.hostname().replace(/\.local$/, '')), { small: true });
console.log(t(`\n   扫不了的话，手动输入密钥：${secret}\n`, `\n   If you can't scan it, enter this key by hand: ${secret}\n`));

let ok = false;
for (let i = 0; i < 3 && !ok; i++) {
  ok = checkTotp(secret, await rl.question(t(
    '2. 输入 Authenticator 显示的 6 位数字确认：',
    '2. Enter the 6-digit code Authenticator is showing: ',
  )));
  if (!ok) console.log(t('   不对，注意要输入当前显示的那组数字。', '   That code did not match. Enter the one currently on screen.'));
}
if (!ok) { console.log(t('没有开启。', 'Not enabled.')); process.exit(1); }

const answer = (await rl.question(t(
  '3. 多少天要求每台设备重新验证一次？（直接回车 = 30 天；输入 0 = 只在配对新设备时验证）',
  '3. How many days between re-checks on each device? (Enter = 30 days; 0 = only when pairing a new device) ',
))).trim();
const everyDays = answer === '' ? 30 : Math.max(0, parseInt(answer, 10) || 0);
enableTotp(secret, everyDays);
console.log(t(
  `\n已开启二次验证：${rule(everyDays)}。已配对的设备从现在开始计时。`,
  `\nTwo-factor verification is on: ${rule(everyDays)}. Devices already paired start their timer now.`,
));
rl.close();
