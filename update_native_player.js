const fs = require('fs');

const path = 'application/android/app/src/main/java/com/lecteur/iptv/NativePlayerActivity.java';
let raw = fs.readFileSync(path, 'utf8');
const isCrlf = raw.includes('\r\n');
let java = raw.replace(/\r\n/g, '\n');

// 1. Center playerView in FrameLayout
const pvTarget = `        // PlayerView
        playerView = new PlayerView(this);
        playerView.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));`;

const pvRepl = `        // PlayerView
        playerView = new PlayerView(this);
        FrameLayout.LayoutParams pvParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        pvParams.gravity = Gravity.CENTER;
        playerView.setLayoutParams(pvParams);`;

if (java.includes(pvTarget)) {
  java = java.replace(pvTarget, pvRepl);
  console.log('playerView centered');
} else {
  console.log('pvTarget not found');
}

// 2. Toolbar title and actionScrollView layout
const titleTarget = `        // Title
        tvTitle = new TextView(this);
        tvTitle.setText(streamTitle);
        tvTitle.setTextSize(15);
        tvTitle.setTextColor(Color.WHITE);
        tvTitle.setTypeface(Typeface.DEFAULT_BOLD);
        tvTitle.setSingleLine(true);
        tvTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        tvTitle.setMinWidth(0);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        tvTitle.setLayoutParams(titleParams);
        topBar.addView(tvTitle);
        // Action buttons container (with horizontal scrolling for narrow screens)
        HorizontalScrollView actionScrollView = new HorizontalScrollView(this);
        actionScrollView.setHorizontalScrollBarEnabled(false);
        actionScrollView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        actionScrollView.setLayoutParams(scrollParams);`;

const titleRepl = `        // Title
        tvTitle = new TextView(this);
        tvTitle.setText(streamTitle);
        tvTitle.setTextSize(15);
        tvTitle.setTextColor(Color.WHITE);
        tvTitle.setTypeface(Typeface.DEFAULT_BOLD);
        tvTitle.setSingleLine(true);
        tvTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        tvTitle.setMinWidth(0);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        titleParams.setMargins(0, 0, dp(8), 0);
        tvTitle.setMaxWidth(dp(130));
        tvTitle.setLayoutParams(titleParams);
        topBar.addView(tvTitle);
        // Action buttons container (with horizontal scrolling for narrow screens)
        HorizontalScrollView actionScrollView = new HorizontalScrollView(this);
        actionScrollView.setHorizontalScrollBarEnabled(false);
        actionScrollView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(
            0,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            1.0f
        );
        actionScrollView.setLayoutParams(scrollParams);`;

if (java.includes(titleTarget)) {
  java = java.replace(titleTarget, titleRepl);
  console.log('Title and actionScrollView updated');
} else {
  console.log('titleTarget not found');
}

// 3. Add btnRotate right after btnRatio
const ratioTarget = `        // Aspect ratio button
        Button btnRatio = new Button(this);
        btnRatio.setText("Format");
        btnRatio.setTextSize(11);
        btnRatio.setTextColor(Color.WHITE);
        btnRatio.setBackgroundColor(Color.parseColor("#334155"));
        btnRatio.setPadding(dp(8), dp(4), dp(8), dp(4));
        btnRatio.setOnClickListener(v -> toggleAspectRatio());
        sizeToolbarButton(btnRatio, 58);
        actionsLayout.addView(btnRatio);`;

const ratioRepl = `        // Aspect ratio button
        Button btnRatio = new Button(this);
        btnRatio.setText("Format");
        btnRatio.setTextSize(11);
        btnRatio.setTextColor(Color.WHITE);
        btnRatio.setBackgroundColor(Color.parseColor("#334155"));
        btnRatio.setPadding(dp(8), dp(4), dp(8), dp(4));
        btnRatio.setContentDescription("Changer le format d'image");
        btnRatio.setOnClickListener(v -> toggleAspectRatio());
        sizeToolbarButton(btnRatio, 58);
        actionsLayout.addView(btnRatio);

        // Rotation plein écran (Paysage / Portrait)
        Button btnRotate = new Button(this);
        btnRotate.setText("⛶");
        btnRotate.setTextSize(13);
        btnRotate.setTextColor(Color.WHITE);
        btnRotate.setBackgroundColor(Color.parseColor("#334155"));
        btnRotate.setContentDescription("Basculer entre plein écran paysage et portrait");
        btnRotate.setOnClickListener(v -> toggleOrientation());
        sizeToolbarButton(btnRotate, 44);
        LinearLayout.LayoutParams rotParams = (LinearLayout.LayoutParams) btnRotate.getLayoutParams();
        rotParams.setMargins(dp(6), 0, 0, 0);
        btnRotate.setLayoutParams(rotParams);
        actionsLayout.addView(btnRotate);`;

if (java.includes(ratioTarget)) {
  java = java.replace(ratioTarget, ratioRepl);
  console.log('btnRotate added');
} else {
  console.log('ratioTarget not found');
}

// 4. Update toggleAspectRatio and add toggleOrientation
const toggleTarget = `    private void toggleAspectRatio() {
        if (currentResizeMode == AspectRatioFrameLayout.RESIZE_MODE_FIT) {
            currentResizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM;
            Toast.makeText(this, "Zoom plein écran", Toast.LENGTH_SHORT).show();
        } else if (currentResizeMode == AspectRatioFrameLayout.RESIZE_MODE_ZOOM) {
            currentResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FILL;
            Toast.makeText(this, "Étiré", Toast.LENGTH_SHORT).show();
        } else {
            currentResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT;
            Toast.makeText(this, "Format original", Toast.LENGTH_SHORT).show();
        }
        playerView.setResizeMode(currentResizeMode);
        scheduleHideControls();
    }`;

const toggleRepl = `    private void toggleOrientation() {
        int orientation = getResources().getConfiguration().orientation;
        if (orientation == Configuration.ORIENTATION_LANDSCAPE) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
            Toast.makeText(this, "Mode portrait", Toast.LENGTH_SHORT).show();
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            Toast.makeText(this, "Plein écran paysage", Toast.LENGTH_SHORT).show();
        }
        scheduleHideControls();
    }

    private void toggleAspectRatio() {
        int orientation = getResources().getConfiguration().orientation;
        if (currentResizeMode == AspectRatioFrameLayout.RESIZE_MODE_FIT) {
            if (orientation == Configuration.ORIENTATION_PORTRAIT) {
                currentResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FILL;
                Toast.makeText(this, "Format adapté (remplissage)", Toast.LENGTH_SHORT).show();
            } else {
                currentResizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM;
                Toast.makeText(this, "Zoom plein écran", Toast.LENGTH_SHORT).show();
            }
        } else if (currentResizeMode == AspectRatioFrameLayout.RESIZE_MODE_ZOOM) {
            currentResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FILL;
            Toast.makeText(this, "Étiré", Toast.LENGTH_SHORT).show();
        } else {
            currentResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT;
            Toast.makeText(this, "Format original (ajusté)", Toast.LENGTH_SHORT).show();
        }
        playerView.setResizeMode(currentResizeMode);
        scheduleHideControls();
    }`;

if (java.includes(toggleTarget)) {
  java = java.replace(toggleTarget, toggleRepl);
  console.log('toggleAspectRatio & toggleOrientation updated');
} else {
  console.log('toggleTarget not found');
}

// 5. Add onConfigurationChanged
const configTarget = `    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {`;

const configRepl = `    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        hideSystemUI();
        if (playerView != null) {
            // En mode portrait, forcer RESIZE_MODE_FIT pour que l'image ne soit jamais coupée
            if (newConfig.orientation == Configuration.ORIENTATION_PORTRAIT) {
                if (currentResizeMode == AspectRatioFrameLayout.RESIZE_MODE_ZOOM) {
                    currentResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT;
                    playerView.setResizeMode(currentResizeMode);
                }
            }
            playerView.requestLayout();
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {`;

if (java.includes(configTarget)) {
  java = java.replace(configTarget, configRepl);
  console.log('onConfigurationChanged added');
} else {
  console.log('configTarget not found');
}

if (isCrlf) {
  java = java.replace(/\n/g, '\r\n');
}

fs.writeFileSync(path, java, 'utf8');
console.log('NativePlayerActivity.java saved successfully.');
