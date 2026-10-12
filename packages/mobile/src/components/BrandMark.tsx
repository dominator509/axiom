import { StyleSheet, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

/** FanThynks Shared Roof mark, matching the dashboard's approved geometry. */
export default function BrandMark() {
  return (
    <View style={styles.frame} accessible={false}>
      <Svg width={21} height={24} viewBox="20 17 140 158" accessible={false}>
        <Polygon
          points="32,57 90,27 148,57 148,77.27 99,51.92 99,160.34 90,165 81,160.34 81,51.92 32,77.27"
          fill="#cfa029"
        />
        <Polygon
          points="32,82.27 50,72.95 50,92 76,78.55 76,98.82 50,112.27 50,144.31 32,135"
          fill="#f5f0e8"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#34484c',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    backgroundColor: '#0c1a20',
  },
});
