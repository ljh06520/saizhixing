import type { Config } from 'tailwindcss';

// Tailwind 会扫描 app 目录下的文件，只把用到的样式打进最终 CSS
const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
