import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import GettingStarted from './pages/GettingStarted';
import Servers from './pages/Servers';
import Routes_ from './pages/Routes';
import Templates from './pages/Templates';
import Matching from './pages/Matching';
import Sequences from './pages/Sequences';
import Proxy from './pages/Proxy';
import GraphQL from './pages/GraphQL';
import WebSocket from './pages/WebSocket';
import Import from './pages/Import';
import Database from './pages/Database';
import Shortcuts from './pages/Shortcuts';
import UIOverview from './pages/UIOverview';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="getting-started" element={<GettingStarted />} />
        <Route path="servers" element={<Servers />} />
        <Route path="routes" element={<Routes_ />} />
        <Route path="templates" element={<Templates />} />
        <Route path="matching" element={<Matching />} />
        <Route path="sequences" element={<Sequences />} />
        <Route path="proxy" element={<Proxy />} />
        <Route path="graphql" element={<GraphQL />} />
        <Route path="websocket" element={<WebSocket />} />
        <Route path="import" element={<Import />} />
        <Route path="database" element={<Database />} />
        <Route path="shortcuts" element={<Shortcuts />} />
        <Route path="ui-overview" element={<UIOverview />} />
      </Route>
    </Routes>
  );
}

export default App;
