import A from "@/renderer/components/A";
import Base from "../Base";
import "./index.scss";

export default function Sparkles() {
    return (
        <Base withBlur defaultClose>
            <div className="modal--sparkles-container shadow backdrop-color">
                <Base.Header>✨✨✨开发者的话</Base.Header>
                <div className="modal--body-container">
                    <p>
                        首先感谢你使用这款软件。
                    </p>

                    <p>
                        现在，本项目已全面更名为 <strong>BakaMusic</strong>，并由 <strong>Zencok</strong>
                        持续维护，作为一个独立项目继续开发与迭代。
                    </p>

                    <p>
                        同时，也感谢原作者 <strong>maotoumao</strong>。
                        BakaMusic 的继续开发建立在原项目的启发与积累之上，因此在重构、扩展与演进的过程中，
                        我也会始终保留对原作者与原项目的尊重。
                    </p>

                    <p>
                        对我来说，BakaMusic 不再只是原项目的桌面延伸，
                        而是一次围绕桌面体验、歌词交互、界面风格与整体结构的重新整理。
                        后续我会按照 BakaMusic 自己的方向继续推进它，让它逐渐形成更完整、更统一的产品形态。
                    </p>

                    <p>
                        当前仓库：
                        <A href="https://github.com/Zencok/BakaMusic">
                            BakaMusic
                        </A>
                    </p>

                    <p>
                        原始桌面项目：
                        <A href="https://github.com/maotoumao/MusicFreeDesktop">
                            MusicFreeDesktop
                        </A>
                    </p>

                    <p className="footer">by: Zencok</p>

                    <div className="secret">
                        希望总有一天，我可以把更多时间投入到真正热爱的事情里，也让 BakaMusic 变成自己真正想做的样子。
                    </div>
                </div>
            </div>
        </Base>
    );
}
