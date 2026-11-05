import { Navigate, type RouteObject } from 'react-router-dom';
import { CenterLayout } from './shared.js';
import { BoardPage, PostPage, ServicePage, ServicesPage } from '../center-board/pages.js';
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
      // 명세 0003: 첫 화면은 실제 공지·소식(center-board), 센터 서비스 탭을 함께 연결한다.
      { index: true, element: <Navigate to="board" replace /> },
      { path: 'board', element: <BoardPage /> },
      { path: 'board/:id', element: <PostPage /> },
      { path: 'services', element: <ServicesPage /> },
      { path: 'services/:id', element: <ServicePage /> },
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
