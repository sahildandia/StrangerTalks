package app.strangertalk.chat;

import static org.junit.Assert.*;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class KeyboardLayoutTest {
    private final AtomicReference<MainActivity> activity = new AtomicReference<>();

    private String js(String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            activity.get().getBridge().getWebView().evaluateJavascript(script, value -> {
                result.set(value);
                done.countDown();
            }));
        assertTrue("WebView JavaScript response", done.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private void awaitJS(String condition) throws Exception {
        for (int attempt = 0; attempt < 100; attempt++) {
            if ("true".equals(js("Boolean(" + condition + ")"))) return;
            Thread.sleep(200);
        }
        fail("WebView condition timed out: " + condition);
    }

    private void screenshot(String name) throws Exception {
        Bitmap bitmap = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        File directory = activity.get().getExternalFilesDir("ui-checks");
        directory.mkdirs();
        try (FileOutputStream output = new FileOutputStream(new File(directory, name + ".png"))) {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
        }
        bitmap.recycle();
    }

    @Test
    public void loginUsesFullSpaceAboveKeyboardWithoutNativeHeader() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity::set);
            awaitJS("document.querySelector('#root') && document.querySelector('#root').children.length > 0");
            js("localStorage.setItem('st-onboarding-v1','done');location.reload();");
            awaitJS("document.querySelector('.auth-screen')");
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                assertTrue("Native action bar must be absent or hidden",
                    activity.get().getSupportActionBar() == null || !activity.get().getSupportActionBar().isShowing());
            });
            assertEquals("No duplicate web header", "0", js("document.querySelectorAll('.topbar').length"));
            screenshot("login");
            for (String selector : new String[]{"input[type=email]", "input[type=password]"}) {
                js("document.querySelector('" + selector + "').focus();");
                InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                    WebView webview = activity.get().getBridge().getWebView();
                    webview.requestFocus();
                    InputMethodManager keyboard = (InputMethodManager) activity.get().getSystemService(Context.INPUT_METHOD_SERVICE);
                    keyboard.showSoftInput(webview, InputMethodManager.SHOW_IMPLICIT);
                });
                boolean visible = false;
                for (int attempt = 0; attempt < 50 && !visible; attempt++) {
                    AtomicReference<Boolean> shown = new AtomicReference<>(false);
                    InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(activity.get().getWindow().getDecorView());
                        shown.set(insets != null && insets.isVisible(WindowInsetsCompat.Type.ime()));
                    });
                    visible = shown.get();
                    Thread.sleep(200);
                }
                assertTrue("Real Android keyboard opened for " + selector, visible);
                Thread.sleep(500);
                InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                    WebView webview = activity.get().getBridge().getWebView();
                    Rect visibleFrame = new Rect();
                    webview.getWindowVisibleDisplayFrame(visibleFrame);
                    int[] position = new int[2];
                    webview.getLocationOnScreen(position);
                    assertTrue("WebView fills the space up to the keyboard: bottom=" + (position[1] + webview.getHeight()) + " visible=" + visibleFrame.bottom,
                        Math.abs(position[1] + webview.getHeight() - visibleFrame.bottom) <= 4);
                });
                awaitJS("Math.abs(document.querySelector('.auth-screen').getBoundingClientRect().bottom-innerHeight)<3");
                screenshot(selector.contains("email") ? "email-keyboard" : "password-keyboard");
            }
        }
    }
}
