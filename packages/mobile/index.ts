import { registerRootComponent } from 'expo';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent, which is what
// the Metro web static renderer and the native runtime both use to mount App.
registerRootComponent(App);
