import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button, Placeholder } from '@/ui';

describe('ui primitives', () => {
  it('Placeholder renders a title and note', () => {
    render(<Placeholder title="Library" note="Soon" />);
    expect(screen.getByText('Library')).toBeTruthy();
    expect(screen.getByText('Soon')).toBeTruthy();
  });

  it('Button fires onPress and respects disabled', () => {
    const onPress = jest.fn();
    render(<Button title="Go" onPress={onPress} testID="go" />);
    fireEvent.press(screen.getByTestId('go'));
    expect(onPress).toHaveBeenCalledTimes(1);

    render(<Button title="No" onPress={onPress} testID="no" disabled />);
    fireEvent.press(screen.getByTestId('no'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
