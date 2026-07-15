import { generateTypeScriptTypes,parseSchema,serializeSchema,type SchemaIrV1 } from "@xecms/schema";

export type StarterName="minimal"|"blog"|"community";
const minimal={format:"xecms.schema",formatVersion:1,collections:[]};
const blog={format:"xecms.schema",formatVersion:1,collections:[
  {id:"col_blog_categories",name:"categories",label:"Categories",hierarchy:{enabled:true,maxDepth:3,ordering:"manual",slugPath:true},fields:[{id:"fld_blog_category_title",name:"title",label:"Title",type:"text",required:true,maxLength:120},{id:"fld_blog_category_slug",name:"slug",label:"Slug",type:"text",required:true,unique:true,maxLength:120}]},
  {id:"col_blog_posts",name:"posts",label:"Posts",fields:[{id:"fld_blog_post_title",name:"title",label:"Title",type:"text",required:true,maxLength:200},{id:"fld_blog_post_slug",name:"slug",label:"Slug",type:"text",required:true,unique:true,maxLength:200},{id:"fld_blog_post_excerpt",name:"excerpt",label:"Excerpt",type:"textarea",maxLength:500},{id:"fld_blog_post_content",name:"content",label:"Content",type:"rich-text",required:true},{id:"fld_blog_post_category",name:"category",label:"Category",type:"relation",relationId:"rel_blog_post_category",targetCollectionId:"col_blog_categories",cardinality:"one",onDelete:"nullify"},{id:"fld_blog_post_cover",name:"cover",label:"Cover",type:"upload",acceptedMimeTypes:["image/png","image/jpeg","image/webp"]}]},
  {id:"col_blog_pages",name:"pages",label:"Pages",hierarchy:{enabled:true,ordering:"manual",slugPath:true},fields:[{id:"fld_blog_page_title",name:"title",label:"Title",type:"text",required:true,maxLength:200},{id:"fld_blog_page_slug",name:"slug",label:"Slug",type:"text",required:true,maxLength:200},{id:"fld_blog_page_content",name:"content",label:"Content",type:"rich-text",required:true}]}
]};
const community={format:"xecms.schema",formatVersion:1,collections:[
  {id:"col_community_members",name:"members",label:"Members",auth:{enabled:true,realmKey:"community",identifierFieldIds:["fld_community_member_email"],acceptSystemIdentities:true,provisioning:"explicit",defaultRoleIds:[]},fields:[{id:"fld_community_member_email",name:"email",label:"Email",type:"text",required:true,unique:true,maxLength:254},{id:"fld_community_member_name",name:"displayName",label:"Display name",type:"text",required:true,maxLength:80},{id:"fld_community_member_bio",name:"bio",label:"Bio",type:"textarea",maxLength:1000}]},
  {id:"col_community_posts",name:"posts",label:"Community Posts",fields:[{id:"fld_community_post_title",name:"title",label:"Title",type:"text",required:true,maxLength:200},{id:"fld_community_post_body",name:"body",label:"Body",type:"rich-text",required:true},{id:"fld_community_post_author",name:"author",label:"Author",type:"relation",relationId:"rel_community_post_author",targetCollectionId:"col_community_members",cardinality:"one",onDelete:"restrict"}]}
]};
const raw:Record<StarterName,unknown>={minimal,blog,community};
export function starterSchema(name:StarterName):SchemaIrV1{return parseSchema(JSON.stringify(raw[name]))}
export function starterArtifacts(name:StarterName){const schema=starterSchema(name);return{schema,manifest:serializeSchema(schema),types:generateTypeScriptTypes(schema)}}
export function isStarterName(value:string):value is StarterName{return value==="minimal"||value==="blog"||value==="community"}
