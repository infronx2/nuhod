import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
    darkMode: "class",
    content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  	extend: {
  		colors: {
  			background: '#FFFFFF',
  			foreground: '#0F172A',
  			card: {
  				DEFAULT: '#FFFFFF',
  				foreground: '#0F172A'
  			},
  			popover: {
  				DEFAULT: '#FFFFFF',
  				foreground: '#0F172A'
  			},
  			primary: {
  				DEFAULT: '#0B5394',
  				foreground: '#FFFFFF'
  			},
  			secondary: {
  				DEFAULT: '#334155',
  				foreground: '#FFFFFF'
  			},
  			muted: {
  				DEFAULT: '#F1F5F9',
  				foreground: '#64748B'
  			},
  			accent: {
  				DEFAULT: '#10B981',
  				foreground: '#FFFFFF'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: '#0B5394',
  			chart: {
  				'1': '#0B5394',
  				'2': '#10B981',
  				'3': '#334155',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		}
  	}
  },
  plugins: [tailwindcssAnimate],
};
export default config;
