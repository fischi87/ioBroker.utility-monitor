
    export type RemoteKeys = 'REMOTE_ALIAS_IDENTIFIER/Components';
    type PackageType<T> = T extends 'REMOTE_ALIAS_IDENTIFIER/Components' ? typeof import('REMOTE_ALIAS_IDENTIFIER/Components') :any;