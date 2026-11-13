import { defineConfig } from "vite";

// base: "./" — сайт работает и в корне домена, и в подпапке GitHub Pages.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    // WebLLM тянет ~6 МБ рантайма, но он грузится лениво, только по кнопке.
    chunkSizeWarningLimit: 7000,
  },
});
