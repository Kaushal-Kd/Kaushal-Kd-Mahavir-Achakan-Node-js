import { useParams } from 'react-router-dom';

import CreateOrder from './CreateOrder.jsx';

const EditBooking = () => {
  const { id } = useParams();
  return <CreateOrder mode="edit" orderId={id} />;
};

export default EditBooking;
