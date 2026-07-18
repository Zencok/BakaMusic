import globals from "globals";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import-x";
import stylistic from "@stylistic/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y-x";

export default [
    // JavaScript 推荐配置
    js.configs.recommended,

    // TypeScript 推荐配置
    ...tseslint.configs.recommended,

    // 全局配置
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es6,
            },
        },
    },    // TypeScript 和 JavaScript 文件配置
    {
        files: ["**/*.{js,mjs,cjs,ts,tsx}"],
        plugins: {
            import: importPlugin,
            "@stylistic": stylistic,
            "react-hooks": reactHooks,
            "jsx-a11y-x": jsxA11y,
        },
        rules: {
            // 保持原有的规则配置
            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-var-requires": "warn",
            "import/no-unresolved": "off",
            "@typescript-eslint/no-empty-interface": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-empty-function": "warn",
            "no-empty": "warn",
            "no-useless-catch": "warn",
            "no-useless-assignment": "off",
            "preserve-caught-error": "off",
            "prefer-const": "warn",
            // 样式规则迁移到 ESLint Stylistic
            "@stylistic/quotes": ["warn", "double"],
            "@stylistic/object-curly-spacing": ["error", "always"],
            "@stylistic/indent": ["error", 4], // 统一缩进
            "@stylistic/semi": ["error", "always"], // 强制分号
            "@stylistic/comma-dangle": ["error", "always-multiline"], // 多行末尾逗号
            "@stylistic/brace-style": ["error", "1tbs"], // 大括号风格

            // Import 相关规则
            "import/no-duplicates": "error",
            "import/no-self-import": "error",
            "import/no-useless-path-segments": "error",            // 企业级最佳实践
            "@typescript-eslint/no-unused-vars": ["warn", {
                "argsIgnorePattern": "^_",
                "varsIgnorePattern": "^_",
            }],
            "@typescript-eslint/no-non-null-assertion": "warn",
            "no-console": "warn",
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",
        },
        settings: {
            "import/resolver": {
                "typescript": {
                    "alwaysTryTypes": true,
                    "project": "./tsconfig.json",
                },
                "node": {
                    "extensions": [".js", ".jsx", ".ts", ".tsx"],
                },
            },
        },
    },

    // 特定于主进程的配置
    {
        files: ["src/main/**/*.{ts,js}"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            "no-console": "off", // 主进程允许使用 console
        },
    },

    // 特定于渲染进程的配置  
    {
        files: ["src/renderer*/**/*.{ts,tsx,js,jsx}"],
        languageOptions: {
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            ...jsxA11y.configs.recommended.rules,
            // Keyboard/focus support for legacy role=button controls is provided
            // centrally by renderer/utils/accessibility.ts and is invisible to AST linting.
            "jsx-a11y-x/click-events-have-key-events": "off",
            "jsx-a11y-x/interactive-supports-focus": "off",
            "jsx-a11y-x/no-static-element-interactions": "off",
        },
        settings: {
            "jsx-a11y": {
                components: {
                    A: "a",
                },
            },
        },
    },

    // Store exposes hook-shaped methods for historical call-site compatibility.
    // The method bodies are stable and unconditional, but the hooks plugin cannot
    // model class-bound custom hooks.
    {
        files: ["src/common/store.ts"],
        rules: {
            "react-hooks/rules-of-hooks": "off",
        },
    },

    // 自有声明文件也执行语法与类型规则；AMLL 上游同步区仍独立维护。
    {
        files: ["src/**/*.d.ts"],
        rules: {
            "@stylistic/indent": "off",
            "@stylistic/comma-dangle": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-empty-object-type": "off",
            "@typescript-eslint/no-unused-vars": ["warn", {
                "argsIgnorePattern": "^_",
                "varsIgnorePattern": "^_",
            }],
        },
    },

    // 配置文件和脚本的特殊规则
    {
        files: ["*.config.{js,ts,mjs}", "scripts/**/*.{js,ts}"],
        rules: {
            "@typescript-eslint/no-var-requires": "off",
            "no-console": "off",
        },
    },

    // 忽略文件
    {
        ignores: [
            "node_modules/**",
            "dist/**",
            ".webpack/**",
            "out/**",
            "release/**",
            "src/amll-core/**",
        ],
    },
];
