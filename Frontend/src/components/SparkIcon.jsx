import PropTypes from 'prop-types'

const SPARK_PATH =
    'M20 12.1C18.49 10.59 17.16 8.11 16.18 6.01C16.15 6 16.12 6 16.08 6' +
    'C16.04 6 16.01 6 15.98 6.01C15 8.11 13.67 10.59 12.15 12.1C10.63 13.61' +
    ' 8.13 14.93 6.01 15.9C6 15.93 6 15.96 6 16C6 16.04 6 16.07 6.01 16.1' +
    'C8.13 17.07 10.63 18.39 12.15 19.9C13.67 21.41 15 23.89 15.98 25.99' +
    'C16.01 26 16.04 26 16.08 26C16.12 26 16.15 26 16.18 25.99C17.16 23.89' +
    ' 18.49 21.41 20.01 19.9C21.53 18.4 23.95 17.07 25.99 16.08C26 16.06' +
    ' 26 16.03 26 16C26 15.97 26 15.94 25.99 15.92C23.95 14.93 21.53 13.6' +
    ' 20 12.1Z'

function SparkIcon({
    size = 14,
    fill = '#A56EFF',
    withCircle = false,
    circleFill = 'rgba(165, 110, 255, 0.15)',
}) {
    return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
            {withCircle && <circle cx="16" cy="16" r="16" fill={circleFill} />}
            <path fillRule="evenodd" clipRule="evenodd" d={SPARK_PATH} fill={fill} />
        </svg>
    )
}

SparkIcon.propTypes = {
    size: PropTypes.number,
    fill: PropTypes.string,
    withCircle: PropTypes.bool,
    circleFill: PropTypes.string,
}

export default SparkIcon
