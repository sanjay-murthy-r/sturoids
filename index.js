// The app's entry. The phone widgets' task handler is registered first, so a launch Android starts only to draw a
// widget (the app closed) finds it; then the router's own entry, as package.json's main was before.
import { bootPhoneWidgets } from './src/widgets/phone/boot';
import 'expo-router/entry';

bootPhoneWidgets();
