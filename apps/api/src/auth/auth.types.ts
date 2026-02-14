export interface RequestWithUser extends Request {
  user: {
    sub: string;
    [key: string]: any;
  };
  headers: Headers & {
    authorization?: string;
    'x-chapter-id'?: string;
  };
}
