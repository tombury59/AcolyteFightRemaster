import _ from 'lodash';
import Immutable from 'immutable';
import * as React from 'react';
import * as ReactRedux from 'react-redux';
import * as Reselect from 'reselect';
import * as playerHelper from '../playerHelper';
import * as StoreProvider from '../../storeProvider';
import * as m from '../../../shared/messages.model';
import * as s from '../../store.model';
import * as w from '../../../game/world.model';
import Interspersed from '../../controls/interspersed';
import PlayerName from '../playerNameComponent';

interface OwnProps {
    message: s.LeaveMessage;
}
interface Props extends OwnProps {
    online: Immutable.Map<string, m.OnlinePlayerMsg>;
}
interface State {
}

function stateToProps(state: s.State, ownProps: OwnProps): Props {
    return {
        ...ownProps,
        online: state.online,
    };
}

class LeftMessage extends React.PureComponent<Props, State> {
    render() {
        const leftPlayers = this.props.message.players.filter(p => !!p.userHash && !this.props.online.has(p.userHash));
        if (leftPlayers.length > 0) {
            return <div className="row">
                <Interspersed items={leftPlayers.map(player => <PlayerName key={player.heroId} player={player} />)} /> left
            </div>
        } else {
            return null;
        }
    }
}

export default ReactRedux.connect(stateToProps)(LeftMessage);