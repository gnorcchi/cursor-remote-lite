// npm run pair            → show a QR / link that pairs one new phone (valid 10 minutes, single use)
// npm run devices         → list paired devices
// npm run devices remove <id>
// npm run reset           → clear pairings, 2FA and configuration
import fs from 'node:fs';
import path from 'node:path';
import qrcode from 'qrcode-terminal';
import { createPairing, appBase, listDevices, removeDevice, totpConfig, DATA_DIR } from './auth.mjs';
import { t, en } from './locale.mjs';

const [cmd = 'list', arg] = process.argv.slice(2);
const fmt = ts => ts ? new Date(ts).toLocaleString(en ? 'en-US' : 'zh-CN', { hour12: false }) : '-';

if (cmd === 'pair') {
  const base = appBase();
  if (!base) {
    console.log(t(
      '还不知道手机 App 的地址：先运行 npm run setup 设置固定地址，或先启动服务（npm run public / npm start）。',
      'The phone app address is not known yet. Run npm run setup for a fixed address, or start the service first (npm run public / npm start).',
    ));
    process.exit(1);
  }
  const { link, minutes } = createPairing(base);
  console.log(t(
    `\n用手机扫码，或把下面的链接发到手机上打开（${minutes} 分钟内有效，只能配对一台设备）：\n`,
    `\nScan with your phone, or open the link below on it (valid for ${minutes} minutes, one device only):\n`,
  ));
  qrcode.generate(link, { small: true });
  console.log(`\n${link}\n`);
  if (totpConfig()) console.log(t(
    '已开启二次验证：配对时还要输入 Authenticator 里的 6 位验证码。\n',
    'Two-factor verification is on: pairing also asks for the 6-digit code from your Authenticator app.\n',
  ));
  console.log(t(
    '安卓 App：在 App 里「粘贴配对链接」，或用浏览器打开链接后点「在 App 中打开」。',
    'Android app: paste the pairing link in the app, or open the link in a browser and tap "Open in app".',
  ));
} else if (cmd === 'remove') {
  if (!arg) {
    console.log(t('用法：npm run devices remove <设备ID>', 'Usage: npm run devices remove <device id>'));
    process.exit(1);
  }
  console.log(removeDevice(arg)
    ? t(`已移除设备 ${arg}，它会立即断开`, `Removed device ${arg}. It disconnects immediately`)
    : t(`没有找到设备 ${arg}`, `No device found with id ${arg}`));
} else if (cmd === 'reset') {
  for (const f of ['url-key', 'devices.json', 'pairing.json', 'totp.json', 'config.json', 'state.json']) {
    fs.rmSync(path.join(DATA_DIR, f), { force: true });
  }
  console.log(t(
    '已重置：所有设备需要重新配对，二次验证已关闭',
    'Reset: every device must pair again, and two-factor verification is off',
  ));
} else {
  const list = listDevices();
  if (!list.length) console.log(t('还没有配对的设备。运行 npm run pair 添加。', 'No devices are paired yet. Run npm run pair to add one.'));
  for (const d of list) console.log(t(
    `${d.id}  ${d.name.padEnd(24)}  配对于 ${fmt(d.created)}  最近使用 ${fmt(d.lastSeen)}`,
    `${d.id}  ${d.name.padEnd(24)}  paired ${fmt(d.created)}  last used ${fmt(d.lastSeen)}`,
  ));
  if (list.length) console.log(t('\n移除设备：npm run devices remove <设备ID>', '\nRemove a device: npm run devices remove <device id>'));
}
