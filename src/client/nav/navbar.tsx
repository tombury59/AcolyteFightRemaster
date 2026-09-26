import classNames from 'classnames';
import * as React from 'react';
import * as ReactRedux from 'react-redux';
import * as m from '../../shared/messages.model';
import * as s from '../store.model';
import * as options from '../options';
import * as pages from '../core/pages';
import * as rooms from '../core/rooms';
import * as url from '../url';
import LoginButton from './loginButton';
import CustomBar from './customBar';
import PageLink from './pageLink';
import RatingControl from './ratingControl';

import './navbar.scss';

interface Props {
    iconsLoaded: boolean;
    page: string;
    userId: string;
    isModded: boolean;
    inParty: boolean;
}

interface State {
}

function stateToProps(state: s.State): Props {
    return {
        iconsLoaded: state.iconsLoaded,
        page: state.current.page,
        userId: state.userId,
        isModded: rooms.isModded(state.room),
        inParty: !!state.party,
    };
}

class NavBar extends React.PureComponent<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
        }
    }

    render() {
        if (this.props.page === "") {
            return this.renderNavBar();
        } else {
            return this.renderBackToHome();
        }
    }

    private renderBackToHome() {
        return <CustomBar>
            <PageLink page=""><i className="fas fa-chevron-left" /><span className="shrink"> Back to</span> Home</PageLink>
            <div className="spacer" />
            <LoginButton />
        </CustomBar>
    }

    private renderNavBar() {
        if (!this.props.iconsLoaded) {
            return null;
        }

        const a = options.getProvider();
        const horizontal = <>
            {this.props.inParty && <PageLink page="party" badge={this.props.inParty} shrink={true}><i className="fas fa-user-friends" title="Party" /></PageLink>}
            <div className="spacer" />
            <LoginButton />
        </>;

        const vertical = a.noMenu ? null : <>
            <PageLink page=""><i className="icon fas fa-home" /> Home</PageLink>
            <PageLink page="profile" profileId={this.props.userId}><i className="icon fas fa-video" /> Replays</PageLink>
            {!a.noPartyLink && <PageLink page="party" badge={this.props.inParty}><i className="icon fas fa-user-friends" /> Party</PageLink>}
            <PageLink page="statistics"><i className="icon fas fa-chart-pie" /> Statistics</PageLink>
            <PageLink page="watch"><i className="icon fas fa-eye" /> Spectate</PageLink>
            <PageLink page="settings"><i className="icon fas fa-cog" /> Settings</PageLink>
            <div className="spacer" />
            <PageLink page="about"><i className="icon fas fa-info-circle" /> About</PageLink>
        </>;
        return <CustomBar vertical={vertical}>{horizontal}</CustomBar>
    }
}

export default ReactRedux.connect(stateToProps)(NavBar);