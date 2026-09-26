import * as React from 'react';
import * as ReactRedux from 'react-redux';
import * as d from '../stats.model';
import * as m from '../../shared/messages.model';
import * as s from '../store.model';
import * as pages from '../core/pages';
import * as url from '../url';
import ControlsPanel from './controlsPanel';
import NameConfig from './nameConfig';
import SpellBtnConfig from './spellConfig';

interface Props {
    current: s.PathElements;
}
interface State {
    category: string;
}

function stateToProps(state: s.State): Props {
    return {
        current: state.current,
    };
}

export class SettingsPanel extends React.PureComponent<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            category: m.GameCategory.PvP,
        };
    }

    render() {
        return <div className="settings-panel">
            <h1>Your Name</h1>
            <NameConfig />
            <h1>Your Options</h1>
            <ControlsPanel />
            <SpellBtnConfig />
        </div>
    }
}

export default ReactRedux.connect(stateToProps)(SettingsPanel);