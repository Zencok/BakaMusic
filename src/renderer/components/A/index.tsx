import { shellUtil } from "@shared/utils/renderer";

export default function A(
    props: React.DetailedHTMLProps<
        React.AnchorHTMLAttributes<HTMLAnchorElement>,
        HTMLAnchorElement
    >,
) {
    const { children, href, onClick, ...rest } = props;
    return (
        <a
            {...rest}
            href={href}
            onClick={(e) => {
                e.preventDefault();
                if (href) {
                    shellUtil.openExternal(href);
                }
                onClick?.(e);
            }}
        >{children}</a>
    );
}
