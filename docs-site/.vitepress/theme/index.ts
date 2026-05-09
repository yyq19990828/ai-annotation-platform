/**
 * VitePress 自定义主题入口。
 * 继承默认主题，注册全局组件。
 */
import DefaultTheme from "vitepress/theme";
import AutoImage from "./components/AutoImage.vue";
import type { Theme } from "vitepress";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("AutoImage", AutoImage);
  },
} satisfies Theme;
