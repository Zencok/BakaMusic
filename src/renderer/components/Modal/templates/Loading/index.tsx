import LoadingContent from "@/renderer/components/Loading";
import Base from "../Base";
import "./index.scss";

interface ILoadingModalProps {
    title: string;
    text?: string;
}

export default function LoadingModal(props: ILoadingModalProps) {
    const { title, text } = props;

    return (
        <Base withBlur={false}>
            <div className="modal--loading shadow backdrop-color">
                <Base.Header>{title}</Base.Header>
                <LoadingContent text={text}></LoadingContent>
            </div>
        </Base>
    );
}
