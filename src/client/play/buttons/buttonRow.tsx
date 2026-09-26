import * as React from 'react';
import * as ReactRedux from 'react-redux';
import * as s from '../../store.model';
import * as StoreProvider from '../../storeProvider';

import Button from '../../controls/button';

interface OwnProps {
    children?: React.ReactNode;
    label: string;
    icon: string;
    secondary?: boolean;
    onClick: () => void;
}
interface Props extends OwnProps {
    displayed: string;
}

interface State {
    hovering: boolean;
}

function stateToProps(state: s.State, ownProps: OwnProps): Props {
    return {
        ...ownProps,
        displayed: state.world.ui.toolbar.hoverButtonPanel,
    };
}

class ButtonRow extends React.PureComponent<Props, State> {
    constructor(props: Props) {
        super(props);

        this.state = {
            hovering: false,
        };
    }

    componentWillUnmount() {
        if (this.state.hovering) {
            this.unhover();
        }
    }

    render() {
        let className = "button-panel-row nav-item";
        if (this.props.secondary) {
            className += " button-panel-secondary";
        }
        return <Button className={className} onMouseEnter={() => this.hover()} onMouseLeave={() => this.unhover()} onClick={this.props.onClick}>
            <span className="button-panel-row-icon"><i className={this.props.icon}>{this.props.children}</i></span>
            <span className="button-panel-row-label">{this.props.label}</span>
        </Button>
    }

    private hover() {
        if (!this.state.hovering) {
            this.setState({ hovering: true });
        }
        if (this.props.displayed !== this.props.label) {
            StoreProvider.dispatch({
                type: "updateToolbar",
                toolbar: { hoverButtonPanel: this.props.label },
            });
        }
    }

    private unhover() {
        if (this.state.hovering) {
            this.setState({ hovering: false });
        }
        // Only release the shared toolbar slot if we still own it, so we don't
        // stomp another row the cursor has already moved onto.
        if (this.props.displayed === this.props.label) {
            StoreProvider.dispatch({
                type: "updateToolbar",
                toolbar: { hoverButtonPanel: null },
            });
        }
    }
}

export default ReactRedux.connect(stateToProps)(ButtonRow);