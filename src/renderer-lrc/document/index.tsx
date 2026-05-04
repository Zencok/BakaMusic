import ReactDOM from "react-dom/client";
import bootstrap from "./bootstrap";
import LyricWindowPage from "../pages";

import "animate.css";
import "rc-slider/assets/index.css";
import "react-toastify/dist/ReactToastify.css";
import "./styles/index.scss"; // Global styles

bootstrap().then(() => {
    ReactDOM.createRoot(document.getElementById("root")).render(<Root></Root>);
});

function Root() {
    return <LyricWindowPage></LyricWindowPage>;
}
