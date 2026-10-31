import {AdminPagination} from "./AdminControlCenter";
export function AdminCursorPagination({state}:{state:{page:number;hasPrevious:boolean;hasNext:boolean;previous:()=>void;next:()=>void}}){
 return <AdminPagination label="Paginación de resultados" page={state.page} hasPrevious={state.hasPrevious} hasNext={state.hasNext} onPrevious={state.previous} onNext={state.next}/>;
}
