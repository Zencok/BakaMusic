import { shellUtil } from "@shared/utils/renderer";

export default function A(
    props: React.DetailedHTMLProps<
        React.AnchorHTMLAttributes<HTMLAnchorElement>,
        HTMLAnchorElement
    >,
) {
    const { href, onClick, ...rest } = props;
    return (
        <a
            {...rest}
            role="button"
            onClick={(e) => {
                e.preventDefault();
                if (href) {
                    shellUtil.openExternal(href);
                }
                onClick?.(e);
            }}
        ></a>
    );
}
