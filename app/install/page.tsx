import type {Metadata} from 'next';
import InstallCard from './install-card';

export const metadata: Metadata = {
  title: 'Install LifeApp',
  description: 'Add the existing LifeApp beta to your home screen.',
  robots: {index: false, follow: false},
};

export default function InstallPage() {
  return <InstallCard />;
}
