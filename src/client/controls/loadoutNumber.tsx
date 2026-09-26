import * as React from 'react';

import './loadoutNumber.scss';

interface Props {
    children?: React.ReactNode;
}

export default class LoadoutNumber extends React.PureComponent<Props> {
    render() {
        return <div className="loadout-number-container">
            <div className="loadout-number">
                {this.props.children}
            </div>
        </div>
    }
}