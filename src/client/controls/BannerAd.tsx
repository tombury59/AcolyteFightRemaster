import * as React from 'react';

interface Props {
    className?: string;
    width: number;
    height: number;
    hideUntilLoaded?: boolean;

    minScreenWidthProportion?: number;
    minScreenHeightProportion?: number;
}

// Ads removed in the remaster (the original project's license only permits
// free, non-commercial use). This component renders nothing.
export class BannerAd extends React.PureComponent<Props> {
    render() {
        return null;
    }
}

export default BannerAd;
