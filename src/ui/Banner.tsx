import { Box, Text, useStdout } from 'ink';
import { APP_NAME, TAGLINE, VERSION } from '../config.js';
import { color } from './theme.js';

const ART = [
  '███████╗██████╗ ███████╗███████╗██████╗  █████╗ ███████╗███████╗',
  '██╔════╝██╔══██╗██╔════╝██╔════╝██╔══██╗██╔══██╗██╔════╝██╔════╝',
  '█████╗  ██████╔╝█████╗  █████╗  ██████╔╝███████║███████╗███████╗',
  '██╔══╝  ██╔══██╗██╔══╝  ██╔══╝  ██╔══██╗██╔══██║╚════██║╚════██║',
  '██║     ██║  ██║███████╗███████╗██████╔╝██║  ██║███████║███████║',
  '╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝',
];

export function Banner() {
  const { stdout } = useStdout();
  const wide = (stdout?.columns ?? 80) >= 66;
  return (
    <Box flexDirection="column" marginBottom={1}>
      {wide ? (
        ART.map((line, i) => (
          <Text key={i} color={color.accent} bold>
            {line}
          </Text>
        ))
      ) : (
        <Text color={color.accent} bold>
          {APP_NAME}
        </Text>
      )}
      <Text color={color.dim}>
        {TAGLINE} <Text color={color.accent2}>v{VERSION}</Text>
      </Text>
    </Box>
  );
}
