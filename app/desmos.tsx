import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { C } from '../src/theme';

export default function Desmos() {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <WebView
        source={{ uri: 'https://www.desmos.com/calculator' }}
        style={{ flex: 1, backgroundColor: C.bg }}
        javaScriptEnabled
        domStorageEnabled // lets Desmos remember the session's graph state
        startInLoadingState
        renderLoading={() => (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
            <ActivityIndicator size="large" color={C.accent} />
          </View>
        )}
      />
    </View>
  );
}
