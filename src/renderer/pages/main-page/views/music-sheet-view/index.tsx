import { useLocation, useParams } from "react-router-dom";
import { localPluginName } from "@/common/constant";
import LocalSheet from "./local-sheet";
import RemoteSheet from "./remote-sheet";

/**
 * path: /main/musicsheet/platform/id
 *
 * state: {
 *  musicSheet: IMusic.MusicSheetItem
 * }
 *
 */
export default function MusicSheetView() {
    const { platform } = useParams() ?? {};
    const location = useLocation();
    const routeState = location.state as {
        sheetItem?: IMusic.IMusicSheetItem;
    } | null;
    const isImportedSheet = routeState?.sheetItem?.isImported === true;

    return (
        <div id="page-container" className="page-container">
            {platform === localPluginName && !isImportedSheet ? (
                <LocalSheet></LocalSheet>
            ) : (
                <RemoteSheet></RemoteSheet>
            )}
        </div>
    );
}
