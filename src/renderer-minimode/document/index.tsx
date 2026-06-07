import ReactDOM from "react-dom/client";

import bootstrap from "./bootstrap";

import MinimodePage from "../pages";

import "animate.css";
import "rc-slider/assets/index.css";
import "react-toastify/dist/ReactToastify.css";
import "./styles/index.scss"; // 全局样式

bootstrap().then(() => {
    ReactDOM.createRoot(document.getElementById("root")).render(<Root></Root>);
});

function Root() {
    return <MinimodePage></MinimodePage>;
}
