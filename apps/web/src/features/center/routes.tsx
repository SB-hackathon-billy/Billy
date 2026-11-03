import { Navigate, type RouteObject } from 'react-router-dom';
import { CenterLayout } from './shared.js';
import {
  AboutPage,
  BusinessPage,
  ClubDetail,
  ClubsPage,
  NewsDetail,
  NewsPage,
  ProgramDetail,
  ProgramsPage,
  SpaceDetail,
  SpacesPage,
} from './pages.js';

export const centerRoutes: RouteObject[] = [
  {
    path: '/center',
    element: <CenterLayout />,
    children: [
      { index: true, element: <Navigate to="about" replace /> },
      { path: 'about', element: <AboutPage /> },
      { path: 'business', element: <BusinessPage /> },
      { path: 'business/:id', element: <ProgramDetail business /> },
      { path: 'programs', element: <ProgramsPage /> },
      { path: 'programs/:id', element: <ProgramDetail /> },
      { path: 'clubs', element: <ClubsPage /> },
      { path: 'clubs/:id', element: <ClubDetail /> },
      { path: 'spaces', element: <SpacesPage /> },
      { path: 'spaces/:id', element: <SpaceDetail /> },
      { path: 'news', element: <NewsPage /> },
      { path: 'news/:id', element: <NewsDetail /> },
    ],
  },
];
