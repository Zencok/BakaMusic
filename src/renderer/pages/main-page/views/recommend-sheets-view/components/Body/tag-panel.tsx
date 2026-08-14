import Condition from "@/renderer/components/Condition";
import classNames from "@/renderer/utils/classnames";
import { getDefaultTag } from ".";
import "./tag-panel.scss";

interface ITagPanelProps {
    id: string;
    show: boolean;
    tagsGroups: IMusic.IMusicSheetGroupItem[];
    selectedId?: string | null;
    onTagClick?: (tag: IMedia.IUnique) => void;
}

export default function TagPanel(props: ITagPanelProps) {
    const { id, show, onTagClick, tagsGroups, selectedId } = props;
    const defaultTag = getDefaultTag();

    if (!show) {
        return null;
    }

    return (
        <div id={id} className="tag-panel--container" data-show={show}>
            <div className="tag-group--container">
                <button
                    type="button"
                    className={classNames({
                        "tag-group--tag": true,
                        highlight: selectedId === defaultTag.id,
                    })}
                    title={defaultTag.title}
                    onClick={() => {
                        onTagClick?.(defaultTag);
                    }}
                >
                    {defaultTag.title}
                </button>
            </div>
            {tagsGroups?.map?.((tagGroup, index) => (
                <div key={index} className="tag-group--container">
                    <Condition condition={tagGroup.title}>
                        <div className="tag-group--title">{tagGroup.title}</div>
                    </Condition>
                    <div className="tag-group--tags">
                        {tagGroup.data.map((tag) => (
                            <button
                                type="button"
                                key={tag.id}
                                className={classNames({
                                    "tag-group--tag": true,
                                    highlight: selectedId === tag.id,
                                })}
                                title={tag.title}
                                onClick={() => {
                                    onTagClick?.(tag);
                                }}
                            >
                                {tag.title}
                            </button>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
