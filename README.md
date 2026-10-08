# Outfit Picker

A free personal web app that picks your outfit each morning from your own
wardrobe and today's weather. Everything is stored on your phone.

## What's in each file

| File | What it does |
|---|---|
| `settings.js` | **All the rules and weights. Edit this to tune your outfits.** |
| `scoring.js` | Lists every valid outfit, scores each one, and picks one |
| `colour.js` | Colour maths: neutral vs coloured, colour wheel, colour detection from photos |
| `weather.js` | Open-Meteo weather and "do I need a layer or coat?" |
| `photo.js` | Background removal and photo tidying |
| `analyse.js` | Reads a photo: main + accent colours, pattern, and a category guess for easy shapes |
| `storage.js` | Saving on the phone, plus backup export/import |
| `app.js` | The screens and buttons |
| `index.html`, `styles.css` | Page layout and look |
| `manifest.json`, `sw.js`, `icons/` | What makes it installable and work offline |
| `serve.ps1` | Test server for your PC (not needed online) |

## Try it on your PC

Right-click `serve.ps1` → **Run with PowerShell**, then open <http://localhost:8080>.

## Put it on your phone (GitHub Pages, free)

1. Create a free account at <https://github.com>.
2. Click **+** → **New repository**. Name it `outfit-picker`, set it to **Public**
   (free Pages needs public; your *wardrobe* data still never leaves your phone),
   tick **Add a README file**, then **Create repository**.
3. Click **Add file → Upload files**. Drag in everything inside this folder,
   including the `icons` folder. Click **Commit changes**.
4. Go to **Settings → Pages**. Under *Branch* choose `main` and `/ (root)`, then **Save**.
5. After a minute, your app is at `https://YOUR-USERNAME.github.io/outfit-picker/`.
6. Open that link in **Chrome on your Android phone** → menu (⋮) → **Add to home screen / Install app**.

To update later: upload the changed files the same way. The app picks up changes the next time it opens online.

## Good to know

- **First photo:** the background remover downloads about 56 MB once (use Wi-Fi). After that it works offline, taking roughly 10–20 seconds per photo.
- **Backups:** Settings → Export backup. Keep the file somewhere safe (e.g. Google Drive).
  Uninstalling the app or clearing Chrome's site data deletes your wardrobe.
- **Background removal** uses IMG.LY's open-source library (AGPL licence), which is free for a personal app like this.
