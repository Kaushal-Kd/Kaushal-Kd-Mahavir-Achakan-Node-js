import { formatCurrency } from '@wrs/shared/utils/currency.js';
import PropTypes from 'prop-types';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/** Placeholder shown instead of an amount while earnings are hidden. */
const MASKED_AMOUNT = '₹••••';

function compactINR(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0';
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(0)}K`;
  return `₹${Math.round(amount)}`;
}

const DashboardChart = ({ variant, data, average = 0, masked = false, onChartClick }) => {
  if (variant === 'bookings') {
    return (
      <div className="h-64 w-full min-w-0">
        <ResponsiveContainer width="100%" height={256} minWidth={0}>
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#E5E7EB' }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#E5E7EB' }} />
            <ReferenceLine y={Number(average.toFixed(2))} stroke="#9CA3AF" strokeDasharray="4 4" />
            <Tooltip
              cursor={{ fill: '#0C6EE114' }}
              formatter={(value) => [`${value}`, 'Bookings']}
              labelFormatter={(label) => `${label}`}
            />
            <Bar dataKey="bookings" fill="#0C6EE1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className={`h-72 w-full min-w-0${onChartClick ? ' cursor-pointer' : ''}`}>
      <ResponsiveContainer width="100%" height={288} minWidth={0}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
          onClick={onChartClick}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="dayLabel"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#E5E7EB' }}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#E5E7EB' }}
            tickFormatter={masked ? () => MASKED_AMOUNT : compactINR}
          />
          <Tooltip
            formatter={(value) => [
              masked ? MASKED_AMOUNT : formatCurrency(Number(value || 0)),
              'Amount',
            ]}
            labelFormatter={(label) => `Day ${label}`}
          />
          <Line
            type="monotone"
            dataKey="amount"
            stroke="#0C6EE1"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

DashboardChart.propTypes = {
  variant: PropTypes.oneOf(['bookings', 'earnings']).isRequired,
  data: PropTypes.arrayOf(PropTypes.object).isRequired,
  average: PropTypes.number,
  /** Earnings variant only: replace every rendered amount with a placeholder. */
  masked: PropTypes.bool,
  /** Earnings variant only: called when the plot area is clicked. */
  onChartClick: PropTypes.func,
};

export default DashboardChart;
