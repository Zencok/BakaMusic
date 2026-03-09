
let canvas: HTMLCanvasElement;

interface IConfig {
    fontSize?: string | number;
    fontFamily?: string;
}

export default function(text: string, config: IConfig){
    const { fontFamily = "sans-serif" } = config;
    let { fontSize = "1rem" } = config;

    if(typeof fontSize === "number") {
        fontSize = `${fontSize}px`;
    }
    if(!canvas) {
        canvas = document.createElement("canvas");
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return 0;
    }
    ctx.font = `${fontSize} ${fontFamily ?? ""}`;
    const metrics = ctx.measureText(text);

    return metrics.width;
}
