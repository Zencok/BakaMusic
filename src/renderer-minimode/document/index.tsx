import ReactDOM from "react-dom/client";

import bootstrap from "./bootstrap";

import MinimodePage from "../pages";

import "animate.css";
import "rc-slider/assets/index.css";
import "react-toastify/dist/ReactToastify.css";
import "./styles/index.scss"; // 全局样式

bootstrap().then(() => {
    const rootElement = document.getElementById("root");
    if (!rootElement) {
        throw new Error("Root element not found");
    }

    ReactDOM.createRoot(rootElement).render(<Root></Root>);
});

function Root() {
    return <MinimodePage></MinimodePage>;
}
