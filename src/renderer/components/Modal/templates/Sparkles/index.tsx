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
                        感谢你使用 <strong>BakaMusic</strong>。
                    </p>

                    <p>
                        这是由 <strong>Zencok</strong> 持续维护的桌面音乐播放器。
                        我希望它不只是一个能播放音乐的工具，也能在歌词展示、桌面交互、本地管理和视觉体验上，
                        保持足够顺手、克制且可靠。
                    </p>

                    <p>
                        后续的开发会继续围绕 BakaMusic 自己的方向推进：
                        优化核心体验，整理界面细节，完善桌面端能力，并尽量让每一次更新都真正带来可感知的改进。
                    </p>

                    <p>
                        如果你愿意关注这个项目，欢迎在 GitHub 上查看进展、反馈问题，或者提出你的想法。
                    </p>

                    <p>
                        Github仓库：
                        <A href="https://github.com/Zencok/BakaMusic">
                            BakaMusic
                        </A>
                    </p>

                    <p className="footer">by: Zencok</p>

                    <div className="secret">
                        希望 BakaMusic 能慢慢变成一个让自己也愿意长期使用、认真打磨的作品。
                    </div>
                </div>
            </div>
        </Base>
    );
}
