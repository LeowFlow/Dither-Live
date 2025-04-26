![Dither.Live logo](https://dither.live/nav_logo.png)
![Dither.Live demo](https://dither.live/top.gif)

---

## 🚀 Features

- **Dithering Algorithms**: Floyd–Steinberg, Jarvis–Judice–Ninke, Bayer Ordered, Atkinson, Sierra  
- **Real-Time Controls**: Scale, contrast, threshold, gamma, pixelation, blur  
- **Upload Options**: Drag & drop, file upload (max 20 MB)  
- **Themes**: Dark and light modes  
- **Gallery**: View community-submitted artworks  
- **Keyboard Shortcuts** and **Accessibility** enhancements

---

## 📁 Repository Structure

```text
dither-live/
├─ Cargo.toml            # Rust/WASM crate manifest
├─ Cargo.lock
├─ wasm/                 # Rust source → generates pkg/ & target/
│  ├─ src/
│  ├─ pkg/
│  └─ target/
├─ www/                  # Web app (Vite/JS)
│  ├─ public/            # Static assets
│  ├─ src/               # HTML, CSS, JS
│  ├─ dist/              # Production build (ignored)
│  ├─ package.json
│  └─ vite.config.js
├─ .gitignore
├─ README.md
└─ LICENSE
```
## 🛠️ Prerequisites

- Rust & wasm-pack  
- Node.js (>=14) & npm or Yarn  

---

## 💻 Install & Run Locally

```
1. Clone the repository
git clone https://github.com/LeowFlow/dither-live.git
cd dither-live

2. Build the WASM package
cd wasm
wasm-pack build --target web --out-dir ../www/src/pkg

3. Install dependencies & start the dev server
cd ../www
npm install       # or yarn
npm run dev       # then open http://localhost:3000 in your browser

4. Build for production
npm run build     # outputs to www/dist
