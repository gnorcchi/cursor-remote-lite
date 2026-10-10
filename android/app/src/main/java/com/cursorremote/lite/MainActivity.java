package com.cursorremote.lite;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import android.widget.Toast;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Locale;

// A thin WebView shell around the user's GitHub Pages app, so it installs without Google Play services or PWA support.
public class MainActivity extends Activity {
    private static final String SETUP = "file:///android_asset/setup.html";
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final String UPDATE_FILE = "CursorRemote-update.apk";
    private static final String SHA_URL = "https://github.com/Suchenl/cursor-remote-lite/releases/latest/download/SHA256SUMS";
    private static final int VOICE = 7;
    private static final int PICK = 8;
    private WebView web;
    private ValueCallback<Uri[]> pickFile;
    private SharedPreferences prefs;

    private final BroadcastReceiver downloaded = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            long id = i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            if (id != -1 && id == prefs.getLong("updateId", -2)) installUpdate(id);
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("cursor-remote", MODE_PRIVATE);
        web = new WebView(this);
        web.setBackgroundColor(0xFF1E1E1E);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUserAgentString(s.getUserAgentString() + " CursorRemoteApp/" + BuildConfigVersion.name(this));

        web.addJavascriptInterface(new Bridge(), "CursorRemoteApp");
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pickFile != null) pickFile.onReceiveValue(null);
                pickFile = callback;
                try {
                    startActivityForResult(params.createIntent(), PICK);
                } catch (Exception e) {
                    pickFile = null;
                    return false;
                }
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("file".equals(u.getScheme()) || sameOrigin(u, appUrl())) return false;
                // Donate links etc. open in the system browser; the bridge is only exposed to the app's own pages.
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) view.loadUrl(SETUP + "?offline=1");
            }
        });

        IntentFilter done = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        // The broadcast comes from the system download provider, a separate app.
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(downloaded, done, Context.RECEIVER_EXPORTED);
        else registerReceiver(downloaded, done);

        if (!openPairLink(getIntent())) {
            String win = getIntent().getStringExtra("win");
            if (win != null) prefs.edit().putString("openWin", win).apply();
            if (state != null) web.restoreState(state);
            else load();
        }
        NotifyService.start(this);
    }

    // WebView's onPause/onResume flip document.visibilityState, which tells the relay whether to notify.
    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        unregisterReceiver(downloaded);
        super.onDestroy();
    }

    private void downloadUpdate(String url) {
        if (!allowedUpdateUrl(url)) {
            Toast.makeText(this, NotifyService.tr("已拒绝这个更新：地址不受信任", "Update refused: that address is not trusted"), Toast.LENGTH_LONG).show();
            return;
        }
        Toast.makeText(this, NotifyService.tr("正在核对发布页上的 SHA-256", "Checking the SHA-256 on the release page"), Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            String expect = officialSha256();
            if (expect == null) {
                runOnUiThread(() -> Toast.makeText(this, NotifyService.tr("找不到官方校验值，已取消更新", "No official checksum was found, so the update was cancelled"), Toast.LENGTH_LONG).show());
                return;
            }
            prefs.edit().putString("updateSha", expect).apply();
            runOnUiThread(() -> enqueueUpdate(url));
        }, "cursor-remote-update").start();
    }

    // The checksum is read from the official release, not from the page, so the page cannot pick its own hash.
    private String officialSha256() {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(SHA_URL).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            c.setInstanceFollowRedirects(true);
            if (c.getResponseCode() != 200) return null;
            String text;
            try (InputStream in = c.getInputStream()) {
                text = new String(readStream(in), StandardCharsets.UTF_8);
            }
            for (String line : text.split("\n")) {
                String trimmed = line.trim();
                if (!trimmed.endsWith("CursorRemote.apk")) continue;
                String hex = trimmed.split("\\s+")[0];
                if (hex.matches("(?i)[0-9a-f]{64}")) return hex.toLowerCase(Locale.US);
            }
            return null;
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static byte[] readStream(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private boolean allowedUpdateUrl(String url) {
        Uri u;
        try { u = Uri.parse(url); } catch (Exception e) { return false; }
        if (u == null || !"https".equalsIgnoreCase(u.getScheme()) || u.getUserInfo() != null) return false;
        if (u.getQuery() != null || u.getFragment() != null) return false;
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        String path = u.getPath() == null ? "" : u.getPath();
        if (path.contains("..")) return false;
        if ("github.com".equals(host)
                && path.matches("/Suchenl/cursor-remote-lite/releases/(download/[^/]+|latest/download)/CursorRemote\\.apk")) {
            return true;
        }
        Uri app = Uri.parse(appUrl());
        String appHost = app.getHost() == null ? "" : app.getHost().toLowerCase(Locale.ROOT);
        return !appHost.isEmpty() && host.equals(appHost) && path.endsWith("/CursorRemote.apk");
    }

    private void enqueueUpdate(String url) {
        DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        long previous = prefs.getLong("updateId", -1);
        if (previous != -1) dm.remove(previous);
        File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir != null) new File(dir, UPDATE_FILE).delete();
        DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url))
                .setTitle(NotifyService.tr("Cursor Remote 更新", "Cursor Remote update"))
                .setMimeType(APK_MIME)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, UPDATE_FILE);
        prefs.edit().putLong("updateId", dm.enqueue(r)).apply();
        Toast.makeText(this, NotifyService.tr("正在下载新版本，下载完会弹出安装界面", "Downloading the update; the installer opens when done"), Toast.LENGTH_LONG).show();
    }

    private void installUpdate(long id) {
        DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        Uri apk = dm.getUriForDownloadedFile(id);
        String expect = prefs.getString("updateSha", "");
        String got = apk == null ? null : sha256(apk);
        if (apk == null || got == null || !got.equals(expect)) {
            dm.remove(id);
            Toast.makeText(this, NotifyService.tr(
                    apk == null ? "下载失败，请稍后在菜单里重试" : "校验失败，已取消安装",
                    apk == null ? "Download failed; retry from the menu later" : "Checksum failed, so the install was cancelled"), Toast.LENGTH_LONG).show();
            return;
        }
        Intent install = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(apk, APK_MIME)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(install);
        } catch (Exception e) {
            Toast.makeText(this, NotifyService.tr("无法打开安装界面，请到浏览器下载安装", "Cannot open the installer; download it in a browser"), Toast.LENGTH_LONG).show();
        }
    }

    private String sha256(Uri uri) {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) md.update(buf, 0, n);
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) sb.append(String.format(Locale.US, "%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (openPairLink(intent)) return;
        String win = intent.getStringExtra("win");
        if (win != null) web.evaluateJavascript("window.openWin && openWin(" + JSONObject.quote(win) + ")", null);
    }

    private void enableNotify(String config) {
        prefs.edit().putString(NotifyService.PREF, config).apply();
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
        // Without this, stock Android may stop the listener after the phone has been idle for a while.
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (!pm.isIgnoringBatteryOptimizations(getPackageName()) && !prefs.getBoolean("askedBattery", false)) {
            prefs.edit().putBoolean("askedBattery", true).apply();
            try {
                startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
            } catch (Exception ignored) {}
        }
        NotifyService.start(this);
    }

    private void disableNotify() {
        prefs.edit().remove(NotifyService.PREF).apply();
        stopService(new Intent(this, NotifyService.class));
    }

    // cursorremote://pair?app=<https app address>&d=<url key>.<one-time code>, handed over by the web app in a browser.
    private boolean openPairLink(Intent intent) {
        Uri u = intent == null ? null : intent.getData();
        if (u == null || !"cursorremote".equals(u.getScheme())) return false;
        String app = u.getQueryParameter("app");
        String d = u.getQueryParameter("d");
        if (app == null || d == null || !app.startsWith("https://") || !d.matches("[\\w-]+\\.[\\w-]+")) return false;
        prefs.edit().putString("url", app).apply();
        web.loadUrl(app + "#pair=" + d);
        return true;
    }

    private String appUrl() {
        String saved = prefs.getString("url", null);
        return saved != null ? saved : getString(R.string.default_url);
    }

    private void load() {
        String url = appUrl();
        web.loadUrl(url.isEmpty() ? SETUP : url);
    }

    private static boolean sameOrigin(Uri u, String base) {
        if (base == null || base.isEmpty()) return false;
        Uri b = Uri.parse(base);
        return u.getScheme() != null && u.getScheme().equals(b.getScheme()) && u.getHost() != null && u.getHost().equals(b.getHost());
    }

    private static Intent voiceIntent(String lang) {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        if (lang != null && !lang.isEmpty()) i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        return i;
    }

    private void voiceResult(String text) {
        web.evaluateJavascript("window.onVoice && onVoice(" + JSONObject.quote(text) + ")", null);
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK) {
            if (pickFile != null) pickFile.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            pickFile = null;
            return;
        }
        if (request != VOICE) return;
        ArrayList<String> heard = result == RESULT_OK && data != null ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
        voiceResult(heard == null || heard.isEmpty() ? "" : heard.get(0));
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private class Bridge {
        @JavascriptInterface
        public String getUrl() {
            return appUrl();
        }

        @JavascriptInterface
        public void setUrl(String url) {
            if (url == null || !url.startsWith("https://")) return;
            // A pasted pairing link keeps its #pair fragment for this load, but only the address is remembered.
            prefs.edit().putString("url", url.split("#")[0]).apply();
            runOnUiThread(() -> { web.clearHistory(); web.loadUrl(url); });
        }

        @JavascriptInterface
        public void retry() {
            runOnUiThread(MainActivity.this::load);
        }

        @JavascriptInterface
        public void changeUrl() {
            runOnUiThread(() -> web.loadUrl(SETUP + "?change=1"));
        }

        // config: {"app","key","token"} from the paired page, or "" to turn notifications off.
        @JavascriptInterface
        public void setNotify(String config) {
            runOnUiThread(() -> {
                if (config == null || config.isEmpty()) disableNotify();
                else enableNotify(config);
            });
        }

        @JavascriptInterface
        public boolean notifyEnabled() {
            return NotifyService.enabled(MainActivity.this);
        }

        // A notification tapped while the app was closed: the page asks for its window once it has connected.
        @JavascriptInterface
        public String takeOpenWin() {
            String win = prefs.getString("openWin", "");
            prefs.edit().remove("openWin").apply();
            return win;
        }

        @JavascriptInterface
        public boolean canVoice() {
            return voiceIntent("").resolveActivity(getPackageManager()) != null;
        }

        // The result comes back through onActivityResult as window.onVoice(text).
        @JavascriptInterface
        public boolean voice(String lang) {
            Intent i = voiceIntent(lang);
            if (i.resolveActivity(getPackageManager()) == null) return false;
            runOnUiThread(() -> {
                try { startActivityForResult(i, VOICE); } catch (Exception e) { voiceResult(""); }
            });
            return true;
        }

        @JavascriptInterface
        public void update(String url, String sha256) {
            // sha256 is required so an older page cannot install a file this build has not checked.
            // The value itself is not trusted: downloadUpdate reads SHA256SUMS from the release.
            if (url == null || sha256 == null || !sha256.matches("(?i)[0-9a-f]{64}")) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, NotifyService.tr("找不到官方校验值，已取消更新", "No official checksum was found, so the update was cancelled"), Toast.LENGTH_LONG).show());
                return;
            }
            runOnUiThread(() -> downloadUpdate(url));
        }
    }
}
